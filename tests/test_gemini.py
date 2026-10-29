import json

import pytest
from fastapi.testclient import TestClient

from helpers import api, login, new_client, up as up_helper

import synth
from app.main import app
from app.services import analytics_lmrb as A
from app.services import gemini_client as G
from app.services import ingest


class Boom(Exception):
    def __init__(self, code, msg="boom"):
        super().__init__(msg)
        self.code = code


def make_service(responses, sleeps):
    svc = G.GeminiService(sleep=sleeps.append)
    calls = []

    def fake(prompt, schema):
        calls.append(prompt)
        r = responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r
    svc._call = fake
    svc.calls = calls
    return svc


GOOD = json.dumps({
    "executive_summary": {"statement": "Spend is concentrated.", "confidence": "high", "evidence": ["F1", "F999"]},
    "competitor_moves": [{"statement": "Move", "confidence": "medium", "evidence": ["F2"]}], "threats": [], "opportunities": [],
    "predicted_behaviour": [], "recommended_actions": [{"statement": "Act", "confidence": "low", "evidence": []}], "data_caveats": ["Short history"]})


@pytest.fixture(scope="module")
def facts():
    df = ingest.parse(synth.to_csv_bytes(synth.make_lmrb()), "s.csv", "lmrb").df
    d = A.dashboard(df, None, None, "Nestle Lanka Ltd")
    return G.build_facts("lmrb", d, None, {"filtered_rows": len(df), "chips": []})


def test_facts_are_numbered_and_bounded(facts):
    assert facts.items[0]["id"] == "F1" and 20 < len(facts.items) < 120
    assert "Nestle Lanka Ltd" in facts.prompt() and "LKR" in facts.prompt()


def test_insights_resolve_evidence_and_flag_bad_citations(facts):
    svc = make_service([GOOD], [])
    out = svc.insights(facts, "lmrb", ["extra caveat"])
    assert out["executive_summary"]["evidence"][0]["id"] == "F1" and out["executive_summary"]["unverified"] == ["F999"]
    assert out["competitor_moves"][0]["evidence"][0]["label"]
    assert out["data_caveats"] == ["Short history", "extra caveat"]
    assert set(out) == {"executive_summary", "competitor_moves", "threats", "opportunities", "predicted_behaviour", "recommended_actions", "data_caveats"}
    assert "<data>" in svc.calls[0] and "Do not use em dashes" in G.EXTRA_RULES


def test_system_prompt_is_as_specified():
    assert G.SYSTEM_PROMPT == ("You are a senior Sri Lankan TV media analyst. Use only the numbers provided. Do not invent data. "
                               "State confidence and caveats. Currency is LKR.")


def test_retries_with_exponential_backoff_then_succeeds(facts):
    sleeps = []
    svc = make_service([Boom(429), Boom(503), GOOD], sleeps)
    assert svc.insights(facts, "lmrb", [])["executive_summary"]["statement"]
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0]


def test_rate_limit_exhaustion_gives_friendly_error(facts):
    svc = make_service([Boom(429)] * 4, [])
    with pytest.raises(G.GeminiError) as e:
        svc.insights(facts, "lmrb", [])
    assert e.value.status == 429 and "rate limited" in str(e.value)


def test_auth_error_not_retried(facts):
    sleeps = []
    svc = make_service([Boom(403)], sleeps)
    with pytest.raises(G.GeminiError, match="API key"):
        svc.insights(facts, "lmrb", [])
    assert sleeps == []


def test_timeout_and_garbage_json(facts):
    svc = make_service([TimeoutError("timed out")] * 4, [])
    with pytest.raises(G.GeminiError) as e:
        svc.insights(facts, "lmrb", [])
    assert e.value.status == 504
    svc = make_service(["not json"] * 4, [])
    with pytest.raises(G.GeminiError, match="could not be read"):
        svc.insights(facts, "lmrb", [])


def test_missing_key_is_a_clear_error(monkeypatch, facts):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(G.GeminiError, match="GEMINI_API_KEY") as e:
        G.GeminiService().insights(facts, "lmrb", [])
    assert e.value.status == 503


def test_chat_answer(facts):
    svc = make_service([json.dumps({"answer": "Nestle leads.", "confidence": "high", "evidence": ["F3", "X"]})], [])
    r = svc.chat(facts, "Who leads?", [{"role": "user", "text": "hi"}])
    assert r["answer"] == "Nestle leads." and r["evidence"][0]["id"] == "F3"


def test_model_env_override(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test")
    assert G.GeminiService().model_name == "gemini-test"
    monkeypatch.delenv("GEMINI_MODEL")
    assert G.GeminiService().model_name == "gemini-2.5-flash"


def test_endpoints_never_leak_key_or_raw_rows(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "SECRET-KEY-123")
    seen = {}

    def fake_call(self, prompt, schema):
        seen["prompt"] = prompt
        return GOOD if schema is G.Insights else json.dumps({"answer": "ok", "confidence": "low", "evidence": []})
    monkeypatch.setattr(G.GeminiService, "_call", fake_call)
    c = api()
    c.post("/api/lmrb/upload", files={"file": ("a.csv", synth.to_csv_bytes(synth.make_lmrb()))})
    r = c.post("/api/insights", json={"kind": "lmrb", "options": {"my_brand": "Nestle Lanka Ltd"}, "forecast": {"metric": "spend", "entity_type": "advertiser", "granularity": "weekly", "horizon_days": 28}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "SECRET-KEY-123" not in r.text and body["insights"]["executive_summary"]["statement"]
    assert "Forecast" in seen["prompt"] and len(seen["prompt"]) < 20000 and "Advt_time" not in seen["prompt"]
    assert any("reliability" in x.lower() for x in body["insights"]["data_caveats"]) or body["insights"]["data_caveats"]
    r2 = c.post("/api/chat", json={"kind": "lmrb", "question": "Who is biggest?"})
    assert r2.status_code == 200 and r2.json()["answer"] == "ok"
    assert c.post("/api/chat", json={"kind": "lmrb", "question": " "}).status_code == 422
    assert c.get("/api/ai-status").json() == {"configured": True, "model": "gemini-2.5-flash"}


def test_endpoint_maps_gemini_errors(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    c = api()
    c.post("/api/lmrb/upload", files={"file": ("a.csv", synth.to_csv_bytes(synth.make_lmrb(days=10)))})
    r = c.post("/api/insights", json={"kind": "lmrb", "refresh": True})
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]

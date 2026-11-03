from translation_worker.routing import (
    ParticipantInfo,
    compute_routes,
    participant_from_attributes,
    should_subscribe,
    track_permissions,
    translated_track_name,
)

SUPPORTED = {"ta-IN", "hi-IN", "en-IN"}
AGENT_ID = "agent-translator"


def human(identity, spoken, listen):
    return ParticipantInfo(identity=identity, kind="standard", spoken_language=spoken, listen_language=listen)


def test_tamil_hindi_routes_have_correct_direction():
    a = human("user-1", "ta-IN", "ta-IN")
    b = human("user-2", "hi-IN", "hi-IN")
    routes = {r.key: r for r in compute_routes([a, b], self_identity=AGENT_ID, supported=SUPPORTED)}
    assert set(routes) == {("user-1", "user-2"), ("user-2", "user-1")}
    flow_a = routes[("user-1", "user-2")]
    assert (flow_a.source_language, flow_a.target_language) == ("ta-IN", "hi-IN")
    flow_b = routes[("user-2", "user-1")]
    assert (flow_b.source_language, flow_b.target_language) == ("hi-IN", "ta-IN")


def test_english_hindi_uses_same_framework():
    routes = compute_routes(
        [human("a", "en-IN", "en-IN"), human("b", "hi-IN", "hi-IN")], self_identity=AGENT_ID, supported=SUPPORTED
    )
    assert {(r.source_language, r.target_language) for r in routes} == {("en-IN", "hi-IN"), ("hi-IN", "en-IN")}


def test_asymmetric_preferences():
    # A speaks Tamil but understands Hindi; B speaks and hears Hindi -> only A's speech needs translating.
    routes = compute_routes(
        [human("a", "ta-IN", "hi-IN"), human("b", "hi-IN", "hi-IN")], self_identity=AGENT_ID, supported=SUPPORTED
    )
    assert [(r.speaker, r.listener, r.source_language, r.target_language) for r in routes] == [
        ("a", "b", "ta-IN", "hi-IN")
    ]


def test_same_language_needs_no_route():
    assert compute_routes([human("a", "hi-IN", "hi-IN"), human("b", "hi-IN", "hi-IN")], self_identity=AGENT_ID, supported=SUPPORTED) == []


def test_agents_and_self_are_never_routed():
    other_agent = ParticipantInfo("agent-2", "agent", "hi-IN", "hi-IN")
    me = ParticipantInfo(AGENT_ID, "standard", "hi-IN", "hi-IN")
    routes = compute_routes(
        [human("a", "ta-IN", "ta-IN"), other_agent, me], self_identity=AGENT_ID, supported=SUPPORTED
    )
    assert routes == []  # only one eligible human -> nobody to translate for


def test_unsupported_or_missing_languages_are_ignored():
    routes = compute_routes(
        [human("a", "ta-IN", "ta-IN"), human("b", "fr-FR", "fr-FR"), human("c", "", "")],
        self_identity=AGENT_ID,
        supported=SUPPORTED,
    )
    assert routes == []


def test_max_two_humans():
    people = [human("a", "ta-IN", "ta-IN"), human("b", "hi-IN", "hi-IN"), human("c", "en-IN", "en-IN")]
    routes = compute_routes(people, self_identity=AGENT_ID, supported=SUPPORTED, max_humans=2)
    assert {r.speaker for r in routes} | {r.listener for r in routes} == {"a", "b"}


def test_voice_comes_from_speaker():
    a = ParticipantInfo("a", "standard", "ta-IN", "ta-IN", voice="kavya")
    b = ParticipantInfo("b", "standard", "hi-IN", "hi-IN", voice="rahul")
    routes = {r.key: r for r in compute_routes([a, b], self_identity=AGENT_ID, supported=SUPPORTED)}
    assert routes[("a", "b")].voice == "kavya"
    assert routes[("b", "a")].voice == "rahul"


def test_attributes_parsing():
    p = participant_from_attributes("u", "standard", {"spoken_language": "ta-IN", "listen_language": "hi-IN", "voice": "x"})
    assert (p.spoken_language, p.listen_language, p.voice) == ("ta-IN", "hi-IN", "x")


def test_feedback_loop_prevention_subscription_rules():
    assert should_subscribe(publisher_identity="user-1", publisher_kind="standard", track_source="microphone", self_identity=AGENT_ID)
    # The worker's own translated tracks / any agent audio are never fed back into recognition.
    assert not should_subscribe(publisher_identity=AGENT_ID, publisher_kind="agent", track_source="microphone", self_identity=AGENT_ID)
    assert not should_subscribe(publisher_identity="agent-x", publisher_kind="agent", track_source="microphone", self_identity=AGENT_ID)
    assert not should_subscribe(publisher_identity="user-1", publisher_kind="standard", track_source="other", self_identity=AGENT_ID)


def test_translated_track_permissions_are_isolated():
    perms = track_permissions({"user-1": "TR_a", "user-2": "TR_b"})
    assert perms == [("user-1", ["TR_a"]), ("user-2", ["TR_b"])]
    assert translated_track_name("user-2") == "translation-for-user-2"


# ---------- phone-line (SIP) callers ----------


def test_phone_caller_without_attributes_uses_auto_and_default():
    caller = participant_from_attributes("sip-caller", "sip", {}, default_phone_language="hi-IN")
    assert (caller.spoken_language, caller.listen_language) == ("auto", "hi-IN")
    detected = participant_from_attributes("sip-caller", "sip", {}, default_phone_language="hi-IN", detected_language="en-IN")
    assert detected.listen_language == "en-IN"


def test_app_user_and_phone_caller_routes():
    user = human("user-1", "ta-IN", "ta-IN")
    caller = participant_from_attributes("sip-caller", "sip", {}, default_phone_language="hi-IN")
    routes = {r.key: r for r in compute_routes([user, caller], self_identity=AGENT_ID, supported=SUPPORTED)}
    assert (routes[("user-1", "sip-caller")].source_language, routes[("user-1", "sip-caller")].target_language) == ("ta-IN", "hi-IN")
    assert (routes[("sip-caller", "user-1")].source_language, routes[("sip-caller", "user-1")].target_language) == ("auto", "ta-IN")


def test_phone_tracks_subscribed_even_without_source_label():
    assert should_subscribe(publisher_identity="sip-1", publisher_kind="sip", track_source="unknown", self_identity=AGENT_ID)
    assert not should_subscribe(publisher_identity="u", publisher_kind="standard", track_source="unknown", self_identity=AGENT_ID)


# ---------- live meetings (one person) ----------


def test_meeting_routes_transcribe_translate_and_playback_flags():
    from translation_worker.routing import compute_meeting_routes

    me = participant_from_attributes("u1", "standard", {"spoken_language": "ta-IN", "listen_language": "en-IN", "voice_playback": "off"})
    (route,) = compute_meeting_routes([me], self_identity=AGENT_ID, supported=SUPPORTED)
    assert (route.speaker, route.listener, route.source_language, route.target_language) == ("u1", "u1", "ta-IN", "en-IN")
    assert route.speak is False and not route.transcribe_only
    same = participant_from_attributes("u1", "standard", {"spoken_language": "hi-IN", "listen_language": "hi-IN"})
    (route,) = compute_meeting_routes([same], self_identity=AGENT_ID, supported=SUPPORTED)
    assert route.transcribe_only and route.speak is False
    agent = ParticipantInfo("a", "agent", "ta-IN", "ta-IN")
    assert compute_meeting_routes([agent], self_identity=AGENT_ID, supported=SUPPORTED) == []

"""Phonebook: saved people with per-contact speak/hear languages."""

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import PhoneNumber
from calls.models import Contact

User = get_user_model()


@pytest.fixture(autouse=True)
def _setup(settings):
    cache.clear()
    settings.LIVEKIT_URL = "ws://localhost:7880"
    settings.LIVEKIT_API_KEY = "testkey"
    settings.LIVEKIT_API_SECRET = "testsecret-testsecret-testsecret-0123"


def client_for(name: str) -> APIClient:
    user, _ = User.objects.get_or_create(username=name)
    c = APIClient()
    c.force_authenticate(user)
    return c


def add(c, target, **extra):
    body = {"target": target, "spoken_language": "ta-IN", "listen_language": "hi-IN", **extra}
    return c.post("/api/contacts/", body, format="json")


@pytest.mark.django_db
def test_save_a_contact_by_username_with_its_own_languages():
    client_for("ravi")
    me = client_for("asha")
    res = add(me, "ravi", name="Ravi anna", favorite=True, spoken_language="ta-IN", listen_language="hi-IN")
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Ravi anna" and body["username"] == "ravi"
    assert (body["spoken_language"], body["listen_language"]) == ("ta-IN", "hi-IN") and body["favorite"] is True


@pytest.mark.django_db
def test_name_defaults_to_the_username():
    client_for("ravi")
    assert add(client_for("asha"), "@Ravi").json()["name"] == "ravi"


@pytest.mark.django_db
def test_save_by_mobile_number_that_signed_in():
    ravi = User.objects.create(username="ravi")
    PhoneNumber.objects.create(user=ravi, number="+919876543210", verified_at=timezone.now())
    res = add(client_for("asha"), "98765 43210", name="Ravi")
    assert res.status_code == 201 and res.json()["username"] == "ravi"


@pytest.mark.django_db
def test_unknown_person_cannot_be_saved():
    res = add(client_for("asha"), "nobody-here")
    assert res.status_code == 404 and res.json()["code"] == "not_found"


@pytest.mark.django_db
def test_cannot_save_yourself_or_the_same_person_twice():
    me = client_for("asha")
    assert add(me, "asha").status_code == 400
    client_for("ravi")
    assert add(me, "ravi").status_code == 201
    again = add(me, "RAVI", name="Other name")
    assert again.status_code == 409 and again.json()["code"] == "duplicate"


@pytest.mark.django_db
def test_languages_are_validated():
    client_for("ravi")
    assert add(client_for("asha"), "ravi", spoken_language="xx-YY").status_code == 400


@pytest.mark.django_db
def test_list_has_favourites_first_then_a_to_z_and_is_private():
    for n in ("ravi", "meena", "bala", "kavi"):
        client_for(n)
    me = client_for("asha")
    add(me, "ravi", name="Ravi")
    add(me, "meena", name="meena")
    add(me, "bala", name="Bala", favorite=True)
    add(client_for("kavi"), "ravi", name="Someone else's contact")
    names = [c["name"] for c in me.get("/api/contacts/").json()]
    assert names == ["Bala", "meena", "Ravi"]  # favourite first, then A-Z ignoring case


@pytest.mark.django_db
def test_edit_star_and_delete_your_own_contact():
    client_for("ravi")
    me = client_for("asha")
    cid = add(me, "ravi").json()["id"]
    res = me.patch(f"/api/contacts/{cid}/", {"name": "Ravi bhai", "listen_language": "en-IN", "favorite": True}, format="json")
    assert res.status_code == 200 and res.json()["name"] == "Ravi bhai" and res.json()["listen_language"] == "en-IN" and res.json()["favorite"] is True
    assert me.patch(f"/api/contacts/{cid}/", {"name": "  "}, format="json").status_code == 400
    assert me.delete(f"/api/contacts/{cid}/").status_code == 204
    assert me.get("/api/contacts/").json() == []


@pytest.mark.django_db
def test_other_users_cannot_see_edit_or_delete_a_contact():
    client_for("ravi")
    cid = add(client_for("asha"), "ravi").json()["id"]
    other = client_for("mallory")
    assert other.get("/api/contacts/").json() == []
    assert other.patch(f"/api/contacts/{cid}/", {"name": "x"}, format="json").status_code == 404
    assert other.delete(f"/api/contacts/{cid}/").status_code == 404
    assert Contact.objects.filter(pk=cid).exists()


@pytest.mark.django_db
def test_calling_a_contact_updates_call_count_and_last_called():
    client_for("ravi")
    me = client_for("asha")
    cid = add(me, "ravi").json()["id"]
    res = me.post("/api/direct/calls/", {"to": "ravi", "spoken_language": "ta-IN", "listen_language": "hi-IN", "video": False}, format="json")
    assert res.status_code == 201
    c = Contact.objects.get(pk=cid)
    assert c.call_count == 1 and c.last_called_at is not None


@pytest.mark.django_db
def test_requires_sign_in():
    assert APIClient().get("/api/contacts/").status_code in (401, 403)

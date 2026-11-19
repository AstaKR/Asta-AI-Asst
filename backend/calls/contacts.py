"""Phonebook: the owner's saved people and the languages to use when calling each of them.

    GET    /api/contacts/          list (favourites first, then A-Z)
    POST   /api/contacts/          {name?, target, spoken_language, listen_language, voice?, favorite?}
    PATCH  /api/contacts/<id>/     change name or languages, star / unstar
    DELETE /api/contacts/<id>/

People are found with the same rule as the dialer (username, or a mobile number that signed in / was added by an
admin). Contacts are private: another user's contact answers 404.
"""

from django.db import IntegrityError
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.validators import validate_language, validate_voice

from .direct import DirectError, find_user
from .models import Contact

MAX_CONTACTS = 500


class ContactSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Contact
        fields = ["id", "name", "target", "username", "spoken_language", "listen_language", "voice", "favorite", "call_count", "last_called_at", "created_at"]
        read_only_fields = ["id", "target", "username", "call_count", "last_called_at", "created_at"]

    def validate_spoken_language(self, v):
        return validate_language(v)

    def validate_listen_language(self, v):
        return validate_language(v)

    def validate_voice(self, v):
        return validate_voice(v)


class CreateSerializer(ContactSerializer):
    target = serializers.CharField(max_length=40)
    name = serializers.CharField(max_length=60, required=False, allow_blank=True)

    class Meta(ContactSerializer.Meta):
        read_only_fields = ["id", "username", "call_count", "last_called_at", "created_at"]


def _mine(request, pk) -> Contact:
    contact = get_object_or_404(Contact.objects.select_related("user"), pk=pk)
    if contact.owner_id != request.user.id:
        raise Http404  # same answer as for a contact that does not exist
    return contact


class ContactListCreateView(APIView):
    def get(self, request):
        contacts = Contact.objects.filter(owner=request.user).select_related("user")
        ordered = sorted(contacts, key=lambda c: (not c.favorite, c.name.casefold()))
        return Response(ContactSerializer(ordered, many=True).data)

    def post(self, request):
        s = CreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if Contact.objects.filter(owner=request.user).count() >= MAX_CONTACTS:
            return Response({"detail": f"You can save up to {MAX_CONTACTS} contacts.", "code": "too_many"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            person = find_user(d["target"])
        except DirectError as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=exc.status)
        if person == request.user:
            return Response({"detail": "That is you.", "code": "self"}, status=status.HTTP_400_BAD_REQUEST)
        existing = Contact.objects.filter(owner=request.user, user=person).first()
        if existing:
            return Response({"detail": f"Already saved as {existing.name}.", "code": "duplicate"}, status=status.HTTP_409_CONFLICT)
        name = (d.get("name") or "").strip() or person.username
        try:
            contact = Contact.objects.create(
                owner=request.user,
                user=person,
                name=name,
                target=d["target"].strip(),
                spoken_language=d.get("spoken_language", "ta-IN"),
                listen_language=d.get("listen_language", "ta-IN"),
                voice=d.get("voice", ""),
                favorite=d.get("favorite", False),
            )
        except IntegrityError:  # two taps at once
            return Response({"detail": "Already saved.", "code": "duplicate"}, status=status.HTTP_409_CONFLICT)
        return Response(ContactSerializer(contact).data, status=status.HTTP_201_CREATED)


class ContactDetailView(APIView):
    def patch(self, request, pk):
        contact = _mine(request, pk)
        s = ContactSerializer(contact, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        if "name" in s.validated_data and not s.validated_data["name"].strip():
            return Response({"detail": "A contact needs a name.", "code": "name_required"}, status=status.HTTP_400_BAD_REQUEST)
        s.save()
        return Response(s.data)

    def delete(self, request, pk):
        _mine(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

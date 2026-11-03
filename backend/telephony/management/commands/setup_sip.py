"""Create the LiveKit SIP trunks and dispatch rule for the phone line (run once after the provider is set up).

    python manage.py setup_sip --dry-run      # show what would be created
    python manage.py setup_sip                # create (existing items with the same name are kept)

Reads from the environment (see docs/TELEPHONY.md):
    SIP_INBOUND_NUMBERS        numbers on the trunk that receive calls, comma separated (E.164)
    SIP_PROVIDER_ADDRESSES     provider signalling IPs/CIDRs allowed to send calls (comma separated)
    SIP_FORWARDED_FROM_HEADER  X-* header carrying the forwarding number (optional, provider-dependent)
    SIP_OUTBOUND_ADDRESS       provider SIP domain for outgoing calls, e.g. <id>.sip.example.com
    SIP_OUTBOUND_NUMBER        caller ID for outgoing calls (E.164)
    SIP_OUTBOUND_USERNAME / SIP_OUTBOUND_PASSWORD   trunk credentials from the provider
"""

import asyncio
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from livekit import api

from calls import livekit_service

INBOUND_NAME = "translator-inbound"
OUTBOUND_NAME = "translator-outbound"
RULE_NAME = "translator-phone-rooms"


def _list(value: str) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


class Command(BaseCommand):
    help = "Create LiveKit SIP inbound/outbound trunks and the per-caller dispatch rule."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, dry_run=False, **opts):
        inbound_numbers = _list(os.environ.get("SIP_INBOUND_NUMBERS", ""))
        addresses = _list(os.environ.get("SIP_PROVIDER_ADDRESSES", ""))
        header = os.environ.get("SIP_FORWARDED_FROM_HEADER", "").strip()
        out_address = os.environ.get("SIP_OUTBOUND_ADDRESS", "").strip()
        out_number = os.environ.get("SIP_OUTBOUND_NUMBER", "").strip()
        if header and not header.lower().startswith("x-"):
            raise CommandError("SIP_FORWARDED_FROM_HEADER must be an X-* header (LiveKit maps only X-* headers to attributes).")

        inbound = None
        if inbound_numbers:
            inbound = api.SIPInboundTrunkInfo(
                name=INBOUND_NAME,
                numbers=inbound_numbers,
                allowed_addresses=addresses,
                headers_to_attributes={header: settings.PHONE_FORWARDED_FROM_ATTRIBUTE} if header else {},
                ringing_timeout={"seconds": settings.PHONE_RING_SECONDS + 15},
                max_call_duration={"seconds": settings.MAX_CALL_DURATION_SECONDS},
            )
        outbound = None
        if out_address and out_number:
            outbound = api.SIPOutboundTrunkInfo(
                name=OUTBOUND_NAME,
                address=out_address,
                numbers=[out_number],
                auth_username=os.environ.get("SIP_OUTBOUND_USERNAME", ""),
                auth_password=os.environ.get("SIP_OUTBOUND_PASSWORD", ""),
            )
        if not inbound and not outbound:
            raise CommandError("Nothing to do: set SIP_INBOUND_NUMBERS and/or SIP_OUTBOUND_ADDRESS + SIP_OUTBOUND_NUMBER.")

        self.stdout.write(f"Inbound trunk: {inbound_numbers or 'skipped'}; allowed from: {addresses or 'ANY (not recommended)'}")
        self.stdout.write(f"Outbound trunk: {out_address or 'skipped'} as {out_number or '-'}")
        self.stdout.write(f"Dispatch rule: one room per caller, prefix '{settings.PHONE_ROOM_PREFIX}'")
        if dry_run:
            return
        livekit_service._require_config()
        asyncio.run(livekit_service._with_api(lambda lk: self._apply(lk, inbound, outbound)))

    async def _apply(self, lk, inbound, outbound):
        if inbound:
            existing = [t for t in (await lk.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())).items if t.name == INBOUND_NAME]
            trunk = existing[0] if existing else await lk.sip.create_inbound_trunk(api.CreateSIPInboundTrunkRequest(trunk=inbound))
            self.stdout.write(self.style.SUCCESS(f"Inbound trunk {'exists' if existing else 'created'}: {trunk.sip_trunk_id}"))
            rules = [r for r in (await lk.sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())).items if r.name == RULE_NAME]
            if rules:
                self.stdout.write(self.style.SUCCESS(f"Dispatch rule exists: {rules[0].sip_dispatch_rule_id}"))
            else:
                rule = await lk.sip.create_dispatch_rule(
                    api.CreateSIPDispatchRuleRequest(
                        name=RULE_NAME,
                        trunk_ids=[trunk.sip_trunk_id],
                        rule=api.SIPDispatchRule(dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix=settings.PHONE_ROOM_PREFIX)),
                    )
                )
                self.stdout.write(self.style.SUCCESS(f"Dispatch rule created: {rule.sip_dispatch_rule_id}"))
        if outbound:
            existing = [t for t in (await lk.sip.list_outbound_trunk(api.ListSIPOutboundTrunkRequest())).items if t.name == OUTBOUND_NAME]
            trunk = existing[0] if existing else await lk.sip.create_outbound_trunk(api.CreateSIPOutboundTrunkRequest(trunk=outbound))
            self.stdout.write(self.style.SUCCESS(f"Outbound trunk {'exists' if existing else 'created'}: {trunk.sip_trunk_id}"))
            self.stdout.write(f"Set LIVEKIT_SIP_OUTBOUND_TRUNK_ID={trunk.sip_trunk_id} in .env")

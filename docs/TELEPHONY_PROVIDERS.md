# Telephony providers for the phone-call bridge (India)

Research date: 2026-10-21. Sources are official LiveKit/provider docs where possible; vendor blogs are marked.
**Nothing here is legal advice. Confirm the regulatory points with the provider and a telecom lawyer before launch.**

## Providers that document LiveKit SIP integration

| Provider | LiveKit status | India numbers | Notes |
|---|---|---|---|
| **Plivo** | On LiveKit's tested-provider list; official LiveKit guide ([docs](https://docs.livekit.io/telephony/start/providers/plivo/), [Plivo page](https://www.plivo.com/livekit/)) | Yes | Published India rates: ₹0.60/min local in/out, ₹250/month per local number ([pricing](https://www.plivo.com/voice/pricing/in/)). Supports TLS/SRTP trunks |
| **Exotel** | On LiveKit's tested-provider list; Exotel publishes a LiveKit guide | Yes (Indian company) | Pricing by quote; platform fee + per-minute + number rent ([review, third-party](https://tomba.io/blog/exotel-pricing-reviews-pros-and-cons)) |
| **Vobiz** | Vobiz publishes a LiveKit guide ([docs](https://www.vobiz.ai/docs/integrations/livekit)) | Claims India DID series (vendor claim) | Not on LiveKit's tested list — verify |

Community reference (unofficial): [livekit-india](https://github.com/Rehansanjay/livekit-india) has Exotel/Plivo trunk presets.

**Mandatory LiveKit setting:** when using Indian numbers or dialling Indian numbers, enable **region pinning** on the
LiveKit Cloud project, or calls fail ([LiveKit Plivo guide](https://docs.livekit.io/telephony/start/providers/plivo/)).

## ⚠️ Regulatory risk — the most important open question

Vendor summaries of Indian rules ([Ozonetel](https://ozonetel.com/voip-in-india/), [TeleCMI](https://www.telecmi.com/blog/voip-legal-in-india))
say domestic **PSTN ↔ VoIP interconnection is restricted** unless it runs through licensed telecom partners, while
app-to-app (IP-only) calls are permitted. Our call-forwarding design connects a normal phone caller (PSTN) to a
user on an internet app — this is exactly the area that needs confirmation.

Before signing up, ask each provider **in writing**:

1. Is bridging an inbound PSTN call (including calls forwarded from a subscriber's own mobile number) to a user
   talking from an internet app permitted under your licence for this use case? Which licence/category covers it?
2. Can our users forward their Jio/Airtel/Vi/BSNL mobile numbers to your virtual numbers? Any number-type restrictions?
3. Is the **original caller's number** (CLI) preserved on forwarded calls? Do you pass the **Diversion / History-Info**
   header (which mobile number forwarded the call) on the SIP INVITE to LiveKit?
4. Outbound: can calls to Indian mobiles from our app present a number assigned to the user? (Presenting the user's
   own mobile number is not expected to be allowed.)
5. Per-minute rates (inbound, outbound), number rent, platform fees, KYC documents needed, time to activate.

## How the answers change the design

| Answer to Q3 | Design |
|---|---|
| Diversion header passed through to LiveKit | One shared virtual number for all users; the backend routes by the forwarding mobile number. Lowest cost |
| Not passed | One virtual number per user (₹250+/month each with Plivo) |

LiveKit maps custom **X-*** SIP headers to participant attributes (`headers_to_attributes`); standard headers such as
Diversion may need `include_headers` or the `lk.sip.GetRemoteHeaders` RPC ([SIP API](https://docs.livekit.io/reference/telephony/sip-api/),
[SIP participant](https://docs.livekit.io/reference/telephony/sip-participant/)). This must be verified with one real
forwarded test call.

## Recommended next step

Contact **Exotel** (Indian, licence-focused) and **Plivo** (clear pricing, LiveKit-tested) with the questions above.
Pick the one that confirms Q1 in writing. Then buy **one** number for a test: one forwarded call answers Q2 and Q3.

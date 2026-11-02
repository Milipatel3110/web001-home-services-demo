#!/usr/bin/env bash
# Live smoke test of the deployed contact pipeline (evidence for T3-T7).
# Usage:
#   ENDPOINT=https://<ref>.supabase.co/functions/v1/contact-submit \
#   ORIGIN=https://<user>.github.io \
#   SUPABASE_URL=https://<ref>.supabase.co ANON_KEY=<public anon/publishable key> \
#   ./scripts/smoke-contact.sh
# Uses only public values. Writes up to 1 row tagged "WEB-001 smoke".
set -uo pipefail
: "${ENDPOINT:?}" "${ORIGIN:?}" "${SUPABASE_URL:?}" "${ANON_KEY:?}"

rid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z')
body=$(printf '{"request_id":"%s","name":"WEB-001 smoke","email":"smoke@example.com","message":"Automated smoke test %s"}' "$rid" "$(date -u +%FT%TZ)")
pass=0 fail=0
check() { # label expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 (HTTP $3)"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}
post() { curl -s -o /tmp/smoke.$$ -w '%{http_code}' -X POST "$ENDPOINT" -H "Origin: $1" -H 'Content-Type: application/json' --data "$2"; }

echo "request_id: $rid"
check "T3 valid submission stored"            200 "$(post "$ORIGIN" "$body")";  cat /tmp/smoke.$$; echo
check "T5 duplicate request_id accepted"      200 "$(post "$ORIGIN" "$body")";  cat /tmp/smoke.$$; echo
check "T4 invalid email rejected"             400 "$(post "$ORIGIN" "${body/smoke@example.com/not-an-email}")"
check "T4 oversized body rejected"            413 "$(post "$ORIGIN" "{\"pad\":\"$(head -c 9000 /dev/zero | tr '\0' x)\"}")"
check "T4 GET rejected"                       405 "$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" "$ENDPOINT")"
check "T7 foreign origin rejected"            403 "$(post "https://evil.example" "$body")"
hp_rid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z')
check "T7 honeypot silently accepted"         200 "$(post "$ORIGIN" "{\"request_id\":\"$hp_rid\",\"name\":\"bot\",\"email\":\"b@example.com\",\"message\":\"spam spam spam\",\"website\":\"x\"}")"

rest() { curl -s -o /tmp/smoke.$$ -w '%{http_code}' "$@" -H "apikey: $ANON_KEY" "$SUPABASE_URL/rest/v1/contact_submissions"; }
code=$(rest -G --data-urlencode "select=request_id")
if [ "$code" != 200 ] || [ "$(cat /tmp/smoke.$$)" = "[]" ]; then echo "PASS  T7 anon cannot read table (HTTP $code, body $(head -c 80 /tmp/smoke.$$))"; pass=$((pass+1));
else echo "FAIL  T7 anon read returned data"; fail=$((fail+1)); fi
code=$(rest -X POST -H 'Content-Type: application/json' --data "{\"request_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"name\":\"xx\",\"email\":\"x@example.com\",\"message\":\"anon insert attempt\"}")
if [ "$code" -ge 400 ]; then echo "PASS  T7 anon cannot insert (HTTP $code)"; pass=$((pass+1)); else echo "FAIL  T7 anon insert returned $code"; fail=$((fail+1)); fi
rm -f /tmp/smoke.$$

echo
echo "$pass passed, $fail failed. Now confirm in Supabase SQL editor:"
echo "  select request_id, name, created_at from contact_submissions where request_id in ('$rid','$hp_rid');"
echo "  -> expect exactly 1 row ($rid); the honeypot id must NOT appear."
[ "$fail" = 0 ]

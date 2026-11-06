#!/bin/sh
# Points gcnpd95.no and www.gcnpd95.no at this server's current public IP (Domeneshop DNS).
# Only needed when the server's IP address can change, e.g. a home connection.
# Create an API token at domeneshop.no (Admin > API) and put it in /etc/gcnpd95-dyndns.env:
#   DOMENESHOP_TOKEN=...
#   DOMENESHOP_SECRET=...
# Then run it every 5 minutes from root's crontab:
#   */5 * * * * /usr/local/bin/domeneshop-dyndns.sh
set -eu
. /etc/gcnpd95-dyndns.env
curl -fsS -u "$DOMENESHOP_TOKEN:$DOMENESHOP_SECRET" \
  "https://api.domeneshop.no/v0/dyndns/update?hostname=gcnpd95.no,www.gcnpd95.no"

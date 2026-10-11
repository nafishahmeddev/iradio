# Security policy

## Supported scope

Security fixes target the latest version on the default branch. Earlier versions
do not have a separate maintenance commitment.

## Report a vulnerability

Do not post exploit details or private stream URLs in a public issue. Use GitHub
private vulnerability reporting if it is enabled for this repository. Otherwise,
contact a maintainer privately through the contact information on their GitHub
profile. If no private channel is listed, open an issue asking for one without
including vulnerability details.

Include affected versions, reproduction steps, impact, and any proposed fix.
There is no guaranteed response deadline or bounty program.

## External services and local data

The app requests station listings from Radio Browser and the International
Public Radio Directory, and the browser opens the selected stream directly from
its broadcaster. Stations, artwork and directory responses are external data;
listing a station does not imply that its stream is trusted or available. The
Worker treats every directory record as untrusted and passes on only validated
http(s) addresses and plain text. Saved stations are stored in the browser and
may contain stream addresses.

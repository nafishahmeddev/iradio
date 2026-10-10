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

The app requests station listings from Radio Browser and opens selected streams
with mpg123. Stations and directory responses are external data; listing a
station does not imply that its stream is trusted or available. Favorites are
stored locally and may contain stream URLs. Keep mpg123 and out123 updated
through your system package manager. The project does not bundle either binary.

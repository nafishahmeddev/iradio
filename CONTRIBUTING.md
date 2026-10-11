# Contributing to iRadio

Bug reports, documentation improvements, accessibility work, and focused pull
requests are welcome. Read the [code of conduct](CODE_OF_CONDUCT.md).

## Get started

Fork the repository, clone your fork, and create a branch for your change.
Node 22 or newer is required.

```sh
npm install
npm run dev
```

## Make a change

Keep pure logic in `src/lib` (it is shared by the site, the Worker and the
tests), the API in `worker/`, and the interface in `src/components` and
`src/scripts`. Colours, sizes and type come from `src/styles/tokens.css`; add a
token rather than a one-off value. Do not add a dependency without explaining
why it is needed.

Tests must not depend on live stations or directories: inject the network.
Add regression coverage when fixing behavior.

```sh
npm run check
npm test
npm run build
```

Look at visual changes in a browser at desktop and phone widths before opening
a pull request, and include a screenshot or recording.

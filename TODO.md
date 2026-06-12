# TODO - Fix /admin not opening

- [ ] Confirm what happens for `/admin` (404 vs blank vs stays on Home) and whether app is served via `vite dev` or `vite preview` / nginx.
- [x] Update `frontend/vite.config.js` to enable SPA history fallback so `/admin` serves `index.html`.

- [ ] Re-test direct navigation to `/admin`.
- [ ] (If still failing) adjust production hosting config (nginx/apache) to route all non-asset requests to `index.html`.
- [ ] Record results.


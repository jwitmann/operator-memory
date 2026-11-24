# Changelog

<!-- markdownlint-disable MD024 --><!-- repeated bucket headings -->

Generated from conventional commits (`scripts/changelog.sh`).
Human-readable record of what shipped, per package.

## [v2.7.0] - 2026-11-24

### Features

- Phase 2 OpenCode sqlite adapter (v2 tables, delta sync, tools) ([`7f0e47f`](https://github.com/jwitmann/vcc-brain/commit/7f0e47fcd20318f3dd6e86fcd918aaae850571ff))
- mutual peer declarations with live proof ([`fa89b1e`](https://github.com/jwitmann/vcc-brain/commit/fa89b1e7dcaab69a304ca604ae6a8981abebde2d))

## [v2.6.0] - 2026-11-22

### Features

- use .vcc-brain roots first, fall back to .operator ([`4943ee9`](https://github.com/jwitmann/vcc-brain/commit/4943ee9cb5cc580e0d74faf3b3288c997a0acf82))
- rename operator-memory to vcc-brain ([`1634359`](https://github.com/jwitmann/vcc-brain/commit/1634359795b2f9b73741774612c84aae2bd4cdf7))

### Other

- migrate this repo to .vcc-brain roots ([`07f9e90`](https://github.com/jwitmann/vcc-brain/commit/07f9e902cc0b517b1f13a7166e0f4432e1aa5f2c))

## [v2.5.0] - 2026-11-22

### Other

- Includes shared core updates (packages/core).

## [v2.4.0] - 2026-11-21

### Features

- add context management config ([`7119f13`](https://github.com/jwitmann/operator-memory/commit/7119f13d25fda860736e21075c70c8d6fcf9f5ad))
- wire trim into the context hook ([`1408e7f`](https://github.com/jwitmann/operator-memory/commit/1408e7f4fdae2dc9c4af68c8aef636540bbed90b))
- add completion trigger ([`1352d4c`](https://github.com/jwitmann/operator-memory/commit/1352d4c89f16f8aa19e550fb0990c41f1a6bfcc7))
- shape compaction ([`fc24875`](https://github.com/jwitmann/operator-memory/commit/fc24875e0151c0c88b3eaabd4e267207858a4a63))
- add operator:read_omitted tool ([`b2771e4`](https://github.com/jwitmann/operator-memory/commit/b2771e40599dc90a5feebe7e6d77994a084f6dad))
- gate context management on the Brain ([`46663d6`](https://github.com/jwitmann/operator-memory/commit/46663d69bfb04b10e09768d6f904c4d64481fd21))
- stop task-complete double-compact after reload ([`eaf36dc`](https://github.com/jwitmann/operator-memory/commit/eaf36dc2100de2fb3c3cb1a628ee5dffd4894e8d))
- cache-aware preamble refresh ([`8d09d5e`](https://github.com/jwitmann/operator-memory/commit/8d09d5e843cb54ce768ea986f6c997d02ded613f))
- address review on preamble refresh ([`fd16903`](https://github.com/jwitmann/operator-memory/commit/fd169037267d8069cdbda3cdd83c91615917dfb7))
- add opt-in Brain-update reminder ([`fb10c4d`](https://github.com/jwitmann/operator-memory/commit/fb10c4dff4678a49ecddd1083ca8b517d7c085b9))
- per-project config override via .operator/config.json ([`af001d6`](https://github.com/jwitmann/operator-memory/commit/af001d63495e8ae3daecc36afb0ccedde492db83))
- log brain-reminder receipts for compliance measurement ([`84f7a78`](https://github.com/jwitmann/operator-memory/commit/84f7a78ffea4f2621040fa84c05481d790870824))
- deterministic override compaction with shaping fallback ([`c224fb4`](https://github.com/jwitmann/operator-memory/commit/c224fb441767ea603a12e82f0c33bac2ff46dcb7))
- port recall and search with snapshot seq parity ([`42deb4d`](https://github.com/jwitmann/operator-memory/commit/42deb4dad1c4455d2c401b04b2694c04858faaad))
- maintain the recall snapshot on every turn ([`9d18d6a`](https://github.com/jwitmann/operator-memory/commit/9d18d6a00f9b5810d99fd82e41606966281280e1))

### Fixes

- suppress compaction requests after host failures ([`96da24f`](https://github.com/jwitmann/operator-memory/commit/96da24f8c4c0f0f8ffaeca813214f407b96cc6f0))
- hyphenate tool names and expose them as native calls ([`37708c4`](https://github.com/jwitmann/operator-memory/commit/37708c4e8a476ff33fb4e8f168309fb67c889fbe))
- adapter-specific compaction recovery sentence ([`0969ef5`](https://github.com/jwitmann/operator-memory/commit/0969ef5506cb8cabe8692ac93b80a63ea4f8e440))
- per-consumer cascade, IFS-free parse, changelog guards ([`6b3bbbd`](https://github.com/jwitmann/operator-memory/commit/6b3bbbdc8aa0b098fa958fed932a1baf084ff86d))

### Documentation

- correct result-override premise per v2.3.2 probe ([`292ca73`](https://github.com/jwitmann/operator-memory/commit/292ca734f40fb2c7f66ea622805eacc3263ae34f))
- DSH context section, V1 unpublished marking, VCC lineage ([`522435d`](https://github.com/jwitmann/operator-memory/commit/522435dbc00fea56154c59621e73535e4ece7fc9))

### Other

- trim via single walk and batch store ([`b11a70f`](https://github.com/jwitmann/operator-memory/commit/b11a70fdaca266df648fdb086be0ea798e03294a))
- resubscribe the event stream once after a failure ([`d1f477a`](https://github.com/jwitmann/operator-memory/commit/d1f477a78f0dc9afe18bc26cb406d6bde2222bbe))
- expire unexecuted compaction causes ([`03777b3`](https://github.com/jwitmann/operator-memory/commit/03777b388353eb30d9ca0ba401a51f5de314a300))
- surface failed receipt writes once per session ([`fa17465`](https://github.com/jwitmann/operator-memory/commit/fa17465ebb7d789710c44c8ee41121fa5cff4970))
- widen refusal helper deps for the staleness guard ([`e5d5931`](https://github.com/jwitmann/operator-memory/commit/e5d59319d6d067ec94cfa624cd7b5769c3fdd884))
- prune tool with auto-cap on store ([`743bf3f`](https://github.com/jwitmann/operator-memory/commit/743bf3f1f8b544f7abe37e942e1d7ca24c85dd05))
- force mtime on Brain rewrites in refresh tests ([`9aa2d62`](https://github.com/jwitmann/operator-memory/commit/9aa2d62cc3b3e3b88b8b961163f3d1c7a75fc4ec))
- cover near-threshold and custom thresholds ([`4bec99e`](https://github.com/jwitmann/operator-memory/commit/4bec99e568b4e2d734ea03ae8e6d23730aee6088))
- force mtime on Brain rewrite in brain-update test ([`bc865d6`](https://github.com/jwitmann/operator-memory/commit/bc865d6a7e056a55e1a3cca48648c3e714d63510))
- Merge branch 'feat/context-management' into perf/context-management ([`20d225d`](https://github.com/jwitmann/operator-memory/commit/20d225decea1afb960fe1108bfc08f5ba6984712))
- Merge branch 'perf/context-management' into feat/preamble-refresh ([`48b2ac5`](https://github.com/jwitmann/operator-memory/commit/48b2ac532a0329fc714ab71dece5292a411fd87f))
- Merge branch 'feat/preamble-refresh' into feat/brain-updates ([`e437c01`](https://github.com/jwitmann/operator-memory/commit/e437c014183f2d3226a562eca689fa72338640b4))
- Merge branch 'origin/main' into feat/context-management ([`2366f78`](https://github.com/jwitmann/operator-memory/commit/2366f783e3116437da533832b375d12077b37940))
- Merge branch 'feat/context-management' into perf/context-management ([`861e779`](https://github.com/jwitmann/operator-memory/commit/861e7793320ea8902d8df686e519087e210d6986))
- Merge branch 'perf/context-management' into feat/preamble-refresh ([`941fc8b`](https://github.com/jwitmann/operator-memory/commit/941fc8b50b846390c928920b4a0c9208dd6f7ce9))
- Merge branch 'feat/preamble-refresh' into feat/brain-updates ([`6751ae8`](https://github.com/jwitmann/operator-memory/commit/6751ae85488194ac1d8e24c225660bbc67a4c62d))
- Merge remote-tracking branch 'origin/main' into feat/context-management ([`028a1ab`](https://github.com/jwitmann/operator-memory/commit/028a1ab4457b8842416cc6c953a29d7d755f0d11))
- Merge branch 'feat/context-management' into perf/context-management ([`9d73cb8`](https://github.com/jwitmann/operator-memory/commit/9d73cb8a491417637301fd489776a7ffed8a3a1b))
- Merge branch 'perf/context-management' into feat/preamble-refresh ([`6272476`](https://github.com/jwitmann/operator-memory/commit/62724766eeef704028893548a6d613a01224c275))
- Merge branch 'feat/preamble-refresh' into feat/brain-updates ([`a65bd33`](https://github.com/jwitmann/operator-memory/commit/a65bd339024ffd0c0eecbb569fcad9b6f2b1d72b))
- prove project config override through setup ([`20fc8e6`](https://github.com/jwitmann/operator-memory/commit/20fc8e69a22c03a054e4df0ba5d7e3a3646a1849))
- Merge branch 'feat/context-management' into feat/brain-reminder-compliance-log ([`33ca248`](https://github.com/jwitmann/operator-memory/commit/33ca248adc453d3d2641f72be4ed18b53cc1e640))
- rename scope to @jwitmann, repoint repo URLs ([`fc3b690`](https://github.com/jwitmann/operator-memory/commit/fc3b69035f1711abbef490eadf6f79eaf87ed561))
- port change-detected release flow ([`f2a0d46`](https://github.com/jwitmann/operator-memory/commit/f2a0d46bcdd878e1b00fdd8061e4282dac51cfc2))

## [v2.3.0] - 2026-11-04

### Features

- make V2 the default and freeze V1 (#62) ([`6826239`](https://github.com/jwitmann/operator-memory/commit/6826239956d9643cc128ef9e72c229bf07d34923))

### Other

- Remove redundant repair commands (#63) ([`c535a55`](https://github.com/jwitmann/operator-memory/commit/c535a558e16612ac82040360b00bb4a87ba108ee))
- publish coordinated package batch (#66) ([`1c1d653`](https://github.com/jwitmann/operator-memory/commit/1c1d653bc25539fc084827480bc377e5f96fb578))

## [v2.2.1] - 2026-10-02

### Fixes

- identify helper package in recovery instructions (#39) ([`c68960d`](https://github.com/jwitmann/operator-memory/commit/c68960d1b444898b228f0e18fd12ae4645d6405c))

### Other

- opencode-v2@v2.2.1 ([`b540e9d`](https://github.com/jwitmann/operator-memory/commit/b540e9d096d71cb74fd9241333a59a2551e8a432))

## [v2.2.0] - 2026-10-02

### Features

- add dev plugin id for local preview (#30) ([`508c05c`](https://github.com/jwitmann/operator-memory/commit/508c05c5106e876466a249b0287b3aa2a7ef3fe2))

### Other

- simplify setup flows (#38) ([`08cee8b`](https://github.com/jwitmann/operator-memory/commit/08cee8b7e71801a5795b442d32730524e4557385))
- opencode-v2@v2.2.0 ([`e6c41f5`](https://github.com/jwitmann/operator-memory/commit/e6c41f5b3fede6f24ecb0b7a0fc1d07cef874e8c))

## [v2.1.0] - 2026-09-24

### Fixes

- compile reactive TUI status ([`e6572f7`](https://github.com/jwitmann/operator-memory/commit/e6572f7187ba27a938d9e1ed6faa80e4a59a6da5))

### Other

- opencode-v2@v2.1.0 ([`1caee13`](https://github.com/jwitmann/operator-memory/commit/1caee13bf19bcc6bae2887d0bfab1e80763f025c))

## [v2.0.0] - 2026-09-24

### Features

- port adapter to stable OpenCode 2 API ([`0bdab4c`](https://github.com/jwitmann/operator-memory/commit/0bdab4ca71812359fbdae727435cb1daa10185b7))

### Other

- opencode-v2@v2.0.0 ([`537c118`](https://github.com/jwitmann/operator-memory/commit/537c1188285294cbeddd5ab9e0569f5829b2d089))

## [v1.0.0] - 2026-09-01

Initial tracked release line.

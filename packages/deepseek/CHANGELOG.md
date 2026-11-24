# Changelog

<!-- markdownlint-disable MD024 --><!-- repeated bucket headings -->

Generated from conventional commits (`scripts/changelog.sh`).
Human-readable record of what shipped, per package.

## [v0.7.0] - 2026-11-24

### Features

- Phase 1 DSH cross-session recall (core ranking, helper FTS5 index/query, DSH tools) ([`7890e04`](https://github.com/jwitmann/vcc-brain/commit/7890e04dda7b50c010f05d96b54fbc1c0ecd3162))
- Phase 2 OpenCode sqlite adapter (v2 tables, delta sync, tools) ([`7f0e47f`](https://github.com/jwitmann/vcc-brain/commit/7f0e47fcd20318f3dd6e86fcd918aaae850571ff))
- mutual peer declarations with live proof ([`fa89b1e`](https://github.com/jwitmann/vcc-brain/commit/fa89b1e7dcaab69a304ca604ae6a8981abebde2d))

## [v0.6.0] - 2026-11-22

### Features

- use .vcc-brain roots first, fall back to .operator ([`4943ee9`](https://github.com/jwitmann/vcc-brain/commit/4943ee9cb5cc580e0d74faf3b3288c997a0acf82))
- rename operator-memory to vcc-brain ([`1634359`](https://github.com/jwitmann/vcc-brain/commit/1634359795b2f9b73741774612c84aae2bd4cdf7))

## [v0.5.0] - 2026-11-22

### Other

- Includes shared core updates (packages/core).

## [v0.4.0] - 2026-11-21

### Features

- port context management, shaping, brain updates, refresh ([`a662ee4`](https://github.com/jwitmann/operator-memory/commit/a662ee473b15a3a36616a1702b77812ce4645eed))
- per-project config override via .operator/config.json ([`91a24bc`](https://github.com/jwitmann/operator-memory/commit/91a24bc3c412e02fbc06df17df3e6a62b1a90e29))
- log brain-reminder receipts for compliance measurement ([`84f7a78`](https://github.com/jwitmann/operator-memory/commit/84f7a78ffea4f2621040fa84c05481d790870824))
- deterministic override compaction with shaping fallback ([`c224fb4`](https://github.com/jwitmann/operator-memory/commit/c224fb441767ea603a12e82f0c33bac2ff46dcb7))
- port recall and search tools with engine attribution ([`26192ef`](https://github.com/jwitmann/operator-memory/commit/26192ef23bed5705226d6cf368b0eb320af7af22))

### Fixes

- evaluate pressure triggers at turn end ([`3d0ac64`](https://github.com/jwitmann/operator-memory/commit/3d0ac649cd126d79586bae656db9d73b91226cd6))
- enforce stashed compaction via per-agent services and idle dispatch ([`f19c761`](https://github.com/jwitmann/operator-memory/commit/f19c76146b09efbb888f5703bf9ac2506a260ee3))
- hyphenate recall tool names, bind host deriver ([`aa4d534`](https://github.com/jwitmann/operator-memory/commit/aa4d534fb50f391cf043d159a9fb85de2b8baf86))
- adapter-specific compaction recovery sentence ([`0969ef5`](https://github.com/jwitmann/operator-memory/commit/0969ef5506cb8cabe8692ac93b80a63ea4f8e440))
- per-consumer cascade, IFS-free parse, changelog guards ([`6b3bbbd`](https://github.com/jwitmann/operator-memory/commit/6b3bbbdc8aa0b098fa958fed932a1baf084ff86d))

### Documentation

- hyphen names are the cross-host convention now ([`f0675c8`](https://github.com/jwitmann/operator-memory/commit/f0675c81131da696203d6d505659b42f7ae8d418))

### Other

- share one preamble fingerprint per assemble ([`00e4e23`](https://github.com/jwitmann/operator-memory/commit/00e4e23b2c03178fc6a9f240eb4c9b8447903a80))
- consolidate per-session service caches into one record ([`d91e901`](https://github.com/jwitmann/operator-memory/commit/d91e9017e2a86930da3e87ddec1c74ebd5b60b1b))
- rename scope to @jwitmann, repoint repo URLs ([`fc3b690`](https://github.com/jwitmann/operator-memory/commit/fc3b69035f1711abbef490eadf6f79eaf87ed561))
- port change-detected release flow ([`f2a0d46`](https://github.com/jwitmann/operator-memory/commit/f2a0d46bcdd878e1b00fdd8061e4282dac51cfc2))

## [v0.3.0] - 2026-11-04

### Other

- Remove redundant repair commands (#63) ([`c535a55`](https://github.com/jwitmann/operator-memory/commit/c535a558e16612ac82040360b00bb4a87ba108ee))
- publish coordinated package batch (#66) ([`1c1d653`](https://github.com/jwitmann/operator-memory/commit/1c1d653bc25539fc084827480bc377e5f96fb578))

## [v0.2.1] - 2026-10-02

### Fixes

- identify helper package in recovery instructions (#39) ([`c68960d`](https://github.com/jwitmann/operator-memory/commit/c68960d1b444898b228f0e18fd12ae4645d6405c))

### Other

- deepseek@v0.2.1 ([`8bf22ae`](https://github.com/jwitmann/operator-memory/commit/8bf22ae74ec05ab5cf6541e9af630e2b0cfce568))

## [v0.2.0] - 2026-10-02

### Other

- simplify setup flows (#38) ([`08cee8b`](https://github.com/jwitmann/operator-memory/commit/08cee8b7e71801a5795b442d32730524e4557385))
- deepseek@v0.2.0 ([`4368d1c`](https://github.com/jwitmann/operator-memory/commit/4368d1c2023eb58a6d5bb8fb81e24914029312ff))

## [v0.1.2] - 2026-10-01

### Fixes

- mark runtime peers optional to silence pnpm profile-install warnings (#37) ([`12ea411`](https://github.com/jwitmann/operator-memory/commit/12ea411ba3f8d0e3da0f6b60e6cb8384f491c4f7))

### Other

- deepseek@v0.1.2 ([`1381e3c`](https://github.com/jwitmann/operator-memory/commit/1381e3c699474de3e3defd48828c20097452f597))

## [v0.1.1] - 2026-10-01

Initial tracked release line.

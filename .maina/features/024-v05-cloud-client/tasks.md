# Task Breakdown

## Tasks

### Track 1: Cloud client (beeeku/maina)
- [ ] T1.1: Create cloud/types.ts — shared API types
- [ ] T1.2: Create cloud/client.ts — HTTP client
- [ ] T1.3: Write client tests
- [ ] T1.4: Create cloud/auth.ts — OAuth device flow
- [ ] T1.5: Write auth tests
- [ ] T1.6: Create maina login/logout command
- [ ] T1.7: Create maina sync push/pull command
- [ ] T1.8: Create maina team command
- [ ] T1.9: Register commands + exports
- [ ] T1.10: maina verify + maina commit

### Track 2: maina-cloud private repo
- [ ] T2.1: Scaffold repo — Bun, Workkit, wrangler.toml
- [ ] T2.2: Workers entrypoint + health endpoint
- [ ] T2.3: D1 schema — teams, members, prompts, feedback
- [ ] T2.4: Auth endpoints — device flow + token
- [ ] T2.5: Prompts endpoints — GET/PUT
- [ ] T2.6: Team endpoints — GET + invite
- [ ] T2.7: Write tests
- [ ] T2.8: CLAUDE.md + commit

## Dependencies

Track 1 and Track 2 are independent — can run in parallel.
T1.1 (types) should be done first in Track 1.
T2.1 (scaffold) should be done first in Track 2.

## Definition of Done

- [ ] All tests pass in both repos
- [ ] maina-cloud /health returns 200
- [ ] maina login works with mocked auth server
- [ ] maina sync push/pull works with mocked API
- [ ] maina team displays team info
- [ ] API types shared between repos

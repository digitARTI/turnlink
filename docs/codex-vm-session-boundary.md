# Managed Codex in a dedicated VM: review candidate

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


The VM can separate Codex and its tool processes from the host broker's files
without putting broker credentials or its store in the guest. The host service
must itself run under an identity and storage boundary that excludes Desktop;
the existing same-UID fixture key is not that boundary. A guest capability is
authority to request only its approved operations, not evidence that the guest
or an MCP backend is trustworthy.

The original ARM64 guest runs a Docker daemon and a limited command relay. A
separate review build now provides the patched Linux ARM64 app-server, and a
disposable guest has started it without host mounts, external network or
secrets. There is still no portable session import. Both guest images and the
host key arrangement are review fixtures, not production provenance or
host-UID isolation. The Linux app-server reported that bubblewrap was absent;
startup does not prove the tool sandbox works.

An experimental capability stream now uses a fresh challenge, distinct HMACs
in both directions, an exact grant digest and a monotonic lifetime check. A
disposable no-network guest has run the real Linux app-server and a synthetic
guest-local MCP server. Its attempt passed through a guest Unix socket relay
and an actual vsock connection to the host owner before the server replied.
The fixture uses a public test key, a synthetic grant and an ad-hoc host
process. It does not authenticate the guest process, secure the host service or
prove the transport against a same-UID host adversary. All observed work
remains uncertain and the inventory remains partial.

A candidate migration must keep the source fenced and the receiver held while
the following steps are performed:

1. Acquire an exact broker grant for the source and destination and capture a
   quiescent native session checkpoint under its reservation. Export only the
   necessary session and rollout data and its bounded identity and policy
   metadata; do not copy a live Codex home, SQLite files, broker credentials,
   arbitrary host paths, or active descriptors. A complete portable native
   export and its consistency proof do not exist yet.
2. Start a verified, disposable Linux ARM64 guest with no shared host mounts,
   using a separately provisioned private guest store and an independently
   verified patched Linux app-server. Deliver the approved checkpoint over a
   bounded authenticated channel. Reconstruct and validate the guest session
   and destination authority, keeping it quarantined and the receiver held.
   A matching thread ID or transcript alone cannot prove authority parity.
3. Bind an exact grant-scoped capability channel to that VM instance, its
   native process and its lifecycle. The host retains the broker guard and
   durable journal; each covered remote dispatch needs its record and ACK
   before sending. Frame bounds, flow control, peer identity, expiry,
   revocation, disconnect and guest or host crash must fail closed. A guest
   key cannot by itself identify which guest process made a request.
4. Reconcile source and destination resource ownership and every remote
   activity, including backends outside MCP. The existing per-attempt journal
   deliberately reports partial inventory and uncertain completion. Only a
   complete, independently attested inventory and exact receiver/commit
   protocol could allow release; no such release is enabled here.

The first migration end-to-end test needs independently verified Linux ARM64
app-server and guest builds, a production host-side scoped vsock gateway, and
an explicit export/import interface for a synthetic session. It must observe actual turns before and
after import, prove source fencing, deny a foreign grant, revoke a live lease,
kill host and guest at send/commit boundaries, and verify recovery without
replay. It must also test denied access from Desktop UID to host secrets and
store under the real provisioned identity. Existing Docker VM and native
component tests do not collectively establish those results.

/**
 * Crypto thread — ZEN keypair derivation runs HERE, off the main thread
 * (the akao Launcher discipline: heavy work never freezes the UI). Built on
 * the kernel's Thread base class — the same protocol the KRN-TH clauses pin.
 */

import Thread from "/_nexus/src/kernel/Thread.js"

class Crypto extends Thread {
    /** Derive a deterministic ZEN keypair from a passphrase (KDF — heavy). */
    async derive({ seed }) {
        const ZEN = (await import("/_nexus/vendor/zen/zen.js")).default
        return await ZEN.pair(null, { seed })
    }
}

new Crypto()

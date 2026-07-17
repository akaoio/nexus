// src/curves/utils.zig — Generic short Weierstrass elliptic curve math.
// No stdlib. Freestanding WASM-compatible.
//
// All field elements are u256 (big-endian representation in memory).
// Intermediate multiplications use u512 to prevent overflow.
//
// Replaces the BigInt-heavy JS curves/utils.js:
//   - JS BigInt point multiply: ~50ms per call in V8
//   - Zig u256 point multiply:  <1ms in WASM
//
// API mirrors the JS module: pointAdd, pointMultiply, deterministicK, etc.

const sha256 = @import("../sha256.zig");
const hmac = @import("../hmac_sha256.zig");

// ── Point ────────────────────────────────────────────────────────────────────

pub const Point = struct { x: u256, y: u256 };

// ── Byte ↔ u256 (big-endian) ─────────────────────────────────────────────────

pub fn bytesToU256(b: *const [32]u8) u256 {
    var n: u256 = 0;
    for (b) |byte| {
        n = (n << 8) | byte;
    }
    return n;
}

pub fn u256ToBytes(n: u256, out: *[32]u8) void {
    var v = n;
    var i: usize = 32;
    while (i > 0) {
        i -= 1;
        out[i] = @intCast(v & 0xff);
        v >>= 8;
    }
}

// ── Prime field arithmetic ────────────────────────────────────────────────────

/// (a + b) mod m — handles u256 addition overflow (a, b < m < 2^256).
pub fn addMod(a: u256, b: u256, m: u256) u256 {
    const res = @addWithOverflow(a, b);
    const r = res[0];
    if (res[1] != 0) {
        // Actual sum = r + 2^256. Since a < m and b < m, actual sum < 2m.
        // result = r + 2^256 - m = r +% (2^256 -% m) = r +% (~m + 1)
        return r +% (~m +% 1);
    }
    if (r >= m) return r - m;
    return r;
}

/// (a - b) mod m — handles underflow.
pub fn subMod(a: u256, b: u256, m: u256) u256 {
    if (a >= b) return a - b;
    return m - (b - a);
}

/// (a * b) mod m — uses u512 intermediate to prevent overflow.
pub fn mulMod(a: u256, b: u256, m: u256) u256 {
    const prod: u512 = @as(u512, a) * @as(u512, b);
    return @intCast(prod % @as(u512, m));
}

/// base^exp mod m — binary exponentiation.
pub fn modPow(base: u256, exp: u256, m: u256) u256 {
    if (m == 1) return 0;
    var result: u256 = 1;
    var b = base % m;
    var e = exp;
    while (e > 0) {
        if (e & 1 == 1) result = mulMod(result, b, m);
        b = mulMod(b, b, m);
        e >>= 1;
    }
    return result;
}

/// Modular inverse via Fermat's little theorem (p must be prime).
pub fn modInv(a: u256, p: u256) u256 {
    return modPow(a % p, p - 2, p);
}

// ── Curve operations ──────────────────────────────────────────────────────────

/// Point addition on y² = x³ + Ax + B (mod P).
/// Returns null for the point at infinity.
pub fn pointAdd(left: ?Point, right: ?Point, P: u256, A: u256) ?Point {
    const l = left orelse return right;
    const r = right orelse return left;

    if (l.x == r.x) {
        if (addMod(l.y, r.y, P) == 0) return null; // P + (-P) = ∞

        // Point doubling: λ = (3x² + A) / (2y)
        const x2 = mulMod(l.x, l.x, P);
        const three_x2 = mulMod(3, x2, P);
        const lam_num = addMod(three_x2, A % P, P);
        const lam_den = mulMod(2, l.y, P);
        const lam = mulMod(lam_num, modInv(lam_den, P), P);
        const lam2 = mulMod(lam, lam, P);
        const x3 = subMod(subMod(lam2, l.x, P), l.x, P);
        const y3 = subMod(mulMod(lam, subMod(l.x, x3, P), P), l.y, P);
        return Point{ .x = x3, .y = y3 };
    }

    // General addition: λ = (y₂ - y₁) / (x₂ - x₁)
    const lam_num = subMod(r.y, l.y, P);
    const lam_den = subMod(r.x, l.x, P);
    const lam = mulMod(lam_num, modInv(lam_den, P), P);
    const lam2 = mulMod(lam, lam, P);
    const x3 = subMod(subMod(lam2, l.x, P), r.x, P);
    const y3 = subMod(mulMod(lam, subMod(l.x, x3, P), P), l.y, P);
    return Point{ .x = x3, .y = y3 };
}

/// Scalar multiplication: scalar * point (double-and-add).
pub fn pointMultiply(scalar: u256, point: Point, P: u256, A: u256, N: u256) ?Point {
    const n = scalar % N;
    if (n == 0) return null;
    var result: ?Point = null;
    var addend: ?Point = point;
    var k = n;
    while (k > 0) {
        if (k & 1 == 1) result = pointAdd(result, addend, P, A);
        addend = pointAdd(addend, addend, P, A);
        k >>= 1;
    }
    return result;
}

/// Check that a point lies on the curve y² ≡ x³ + Ax + B (mod P).
pub fn isOnCurve(pt: Point, P: u256, A: u256, B: u256) bool {
    if (pt.x >= P or pt.y >= P) return false;
    const y2 = mulMod(pt.y, pt.y, P);
    const x3 = mulMod(mulMod(pt.x, pt.x, P), pt.x, P);
    const ax = mulMod(A % P, pt.x, P);
    return y2 == addMod(addMod(x3, ax, P), B % P, P);
}

/// Compact (compressed) point encoding: 0x02/0x03 || x (33 bytes).
pub fn compactPoint(pt: Point, out: *[33]u8) void {
    out[0] = if ((pt.y & 1) == 1) 0x03 else 0x02;
    u256ToBytes(pt.x, out[1..33]);
}

// ── RFC 6979 deterministic k ───────────────────────────────────────────────────
// Deterministic nonce generation for ECDSA signing.
// Mirrors the JS deterministicK function from curves/utils.js.

pub fn deterministicK(
    priv_bytes: *const [32]u8, // private key (big-endian 32 bytes)
    hash_bytes: *const [32]u8, // message hash (big-endian 32 bytes)
    attempt: u8, // retry counter (0 for first attempt)
    N: u256, // curve order
    out: *[32]u8, // output: deterministic k (big-endian 32 bytes)
) void {
    // h1 = bytesToBigInt(hash_bytes) % N, encoded as 32 bytes
    const h_int = bytesToU256(hash_bytes);
    const h1_int = h_int % N;
    var h1: [32]u8 = undefined;
    u256ToBytes(h1_int, &h1);

    var K: [32]u8 = [_]u8{0} ** 32;
    var V: [32]u8 = [_]u8{1} ** 32;

    // msg = V || sep || priv || h1 [ || attempt ]
    const msg_len: usize = if (attempt > 0) 98 else 97;
    var msg: [98]u8 = undefined;

    // Step b: K = HMAC_K(V || 0x00 || priv || h1 [|| attempt])
    @memcpy(msg[0..32], &V);
    msg[32] = 0x00;
    @memcpy(msg[33..65], priv_bytes);
    @memcpy(msg[65..97], &h1);
    if (attempt > 0) msg[97] = attempt;
    hmac.hmac(&K, msg[0..msg_len], &K);

    // Step c: V = HMAC_K(V)
    hmac.hmac(&K, &V, &V);

    // Step d: K = HMAC_K(V || 0x01 || priv || h1 [|| attempt])
    @memcpy(msg[0..32], &V);
    msg[32] = 0x01;
    @memcpy(msg[33..65], priv_bytes);
    @memcpy(msg[65..97], &h1);
    if (attempt > 0) msg[97] = attempt;
    hmac.hmac(&K, msg[0..msg_len], &K);

    // Step e: V = HMAC_K(V)
    hmac.hmac(&K, &V, &V);

    // Generate k
    while (true) {
        hmac.hmac(&K, &V, &V);
        const candidate = bytesToU256(&V);
        if (candidate > 0 and candidate < N) {
            @memcpy(out, &V);
            return;
        }
        // Retry
        var refresh: [33]u8 = undefined;
        @memcpy(refresh[0..32], &V);
        refresh[32] = 0x00;
        hmac.hmac(&K, &refresh, &K);
        hmac.hmac(&K, &V, &V);
    }
}

// ── hashToScalar ─────────────────────────────────────────────────────────────
// Mirrors the JS hashToScalar: SHA256(label || seed) reduced to a non-zero scalar.

pub fn hashToScalar(seed: []const u8, label: []const u8, N: u256, out: *[32]u8) void {
    var ctx = sha256.init();
    sha256.update(&ctx, label);
    sha256.update(&ctx, seed);
    sha256.final(&ctx, out);
    // Reduce mod (N-1) then add 1 → result in [1, N-1]
    const n = bytesToU256(out);
    const reduced = (n % (N - 1)) + 1;
    u256ToBytes(reduced, out);
}

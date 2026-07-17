// src/curves/p256.zig — NIST P-256 (secp256r1) curve parameters and thin wrappers.
// y² = x³ - 3x + B (mod P)  — A = P - 3

const utils = @import("utils.zig");

pub const P = @as(u256, 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF);
pub const N = @as(u256, 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551);
// A = -3 mod P  = P - 3
pub const A = @as(u256, 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC);
pub const B = @as(u256, 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B);
pub const Gx = @as(u256, 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296);
pub const Gy = @as(u256, 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5);
pub const G = utils.Point{ .x = Gx, .y = Gy };
pub const HALF_N = N >> 1;

pub fn pointAdd(a: ?utils.Point, b: ?utils.Point) ?utils.Point {
    return utils.pointAdd(a, b, P, A);
}

pub fn pointMultiply(scalar: u256, point: utils.Point) ?utils.Point {
    return utils.pointMultiply(scalar, point, P, A, N);
}

pub fn pointMultiplyG(scalar: u256) ?utils.Point {
    return utils.pointMultiply(scalar, G, P, A, N);
}

pub fn isOnCurve(pt: utils.Point) bool {
    return utils.isOnCurve(pt, P, A, B);
}

pub fn deterministicK(priv_bytes: *const [32]u8, hash_bytes: *const [32]u8, attempt: u8, out: *[32]u8) void {
    utils.deterministicK(priv_bytes, hash_bytes, attempt, N, out);
}

pub fn hashToScalar(seed: []const u8, label: []const u8, out: *[32]u8) void {
    utils.hashToScalar(seed, label, N, out);
}

// src/curves/secp256k1.zig — secp256k1 curve parameters and thin wrappers.
// y² = x³ + 7 (mod P)  — A=0, B=7

const utils = @import("utils.zig");

pub const P = @as(u256, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F);
pub const N = @as(u256, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141);
pub const A: u256 = 0;
pub const B: u256 = 7;
pub const Gx = @as(u256, 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798);
pub const Gy = @as(u256, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8);
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

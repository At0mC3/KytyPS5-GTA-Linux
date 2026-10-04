// v_fract_f64 in both encodings, plain and with source modifiers: VOP1 0x3e and VOP3 0x1be. The
// operand comes from the lane id, so nothing folds. Replays cleanly.
  v_cvt_f64_i32 v[2:3], v0
  v_mul_f64 v[2:3], v[2:3], 0.5
  v_lshlrev_b32 v1, 3, v0
  v_fract_f64_e32 v[4:5], v[2:3]
  v_fract_f64_e64 v[6:7], -v[2:3]
  v_fract_f64_e64 v[8:9], |v[2:3]|
  v_fract_f64_e64 v[10:11], -|v[2:3]|
  buffer_store_dwordx2 v[4:5], v1, s[0:3], 0 offen
  buffer_store_dwordx2 v[6:7], v1, s[0:3], 0 offen offset:512
  buffer_store_dwordx2 v[8:9], v1, s[0:3], 0 offen offset:1024
  buffer_store_dwordx2 v[10:11], v1, s[0:3], 0 offen offset:1536
  s_endpgm

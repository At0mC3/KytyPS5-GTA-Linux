// The 64-bit integer compares, wave64: V_CMP_* writes VCC (VOPC) or an SGPR pair (VOP3), V_CMPX_*
// writes EXEC, for the signed and unsigned forms and for every relation from F to T. The operands
// come from the lane id, so nothing folds, and every result selects a bit of an accumulator that
// is stored at the end. `v_cmp_ne_i64 s[6:7], s[4:5], 0` is the instruction GTA V's compute shader
// 0x8395e43f382309df aborted on (VOP3 0xa5). Replays cleanly.
  v_lshlrev_b32 v1, 2, v0
  v_subrev_nc_u32 v2, 32, v0
  v_ashrrev_i32 v3, 31, v2
  v_subrev_nc_u32 v4, 16, v0
  v_ashrrev_i32 v5, 31, v4
  v_readfirstlane_b32 s4, v2
  v_readfirstlane_b32 s5, v3
  s_mov_b64 s[20:21], exec
  v_mov_b32 v11, 0
  v_mov_b32 v12, 0
  v_mov_b32 v13, 0
  v_mov_b32 v14, 0
  v_cmp_ne_i64 s[6:7], s[4:5], 0
  v_cndmask_b32_e64 v10, 0, 1, s[6:7]
  v_or_b32 v11, v11, v10
  v_cmp_f_i64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v11, v10, 0, v11
  v_cmp_lt_i64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v11, v10, 1, v11
  v_cmp_eq_i64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v11, v10, 2, v11
  v_cmp_le_i64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v11, v10, 3, v11
  v_cmp_gt_i64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v11, v10, 4, v11
  v_cmp_ne_i64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v11, v10, 5, v11
  v_cmp_ge_i64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v11, v10, 6, v11
  v_cmp_t_i64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v11, v10, 7, v11
  v_cmp_f_u64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v12, v10, 0, v12
  v_cmp_lt_u64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v12, v10, 1, v12
  v_cmp_eq_u64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v12, v10, 2, v12
  v_cmp_le_u64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v12, v10, 3, v12
  v_cmp_gt_u64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v12, v10, 4, v12
  v_cmp_ne_u64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v12, v10, 5, v12
  v_cmp_ge_u64_e32 vcc, v[2:3], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, vcc
  v_lshl_or_b32 v12, v10, 6, v12
  v_cmp_t_u64_e64 s[8:9], s[4:5], v[4:5]
  v_cndmask_b32_e64 v10, 0, 1, s[8:9]
  v_lshl_or_b32 v12, v10, 7, v12
  v_mov_b32 v10, 0
  v_cmpx_f_i64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 0, v13
  v_mov_b32 v10, 0
  v_cmpx_lt_i64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 1, v13
  v_mov_b32 v10, 0
  v_cmpx_eq_i64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 2, v13
  v_mov_b32 v10, 0
  v_cmpx_le_i64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 3, v13
  v_mov_b32 v10, 0
  v_cmpx_gt_i64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 4, v13
  v_mov_b32 v10, 0
  v_cmpx_ne_i64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 5, v13
  v_mov_b32 v10, 0
  v_cmpx_ge_i64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 6, v13
  v_mov_b32 v10, 0
  v_cmpx_t_i64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v13, v10, 7, v13
  v_mov_b32 v10, 0
  v_cmpx_f_u64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 0, v14
  v_mov_b32 v10, 0
  v_cmpx_lt_u64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 1, v14
  v_mov_b32 v10, 0
  v_cmpx_eq_u64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 2, v14
  v_mov_b32 v10, 0
  v_cmpx_le_u64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 3, v14
  v_mov_b32 v10, 0
  v_cmpx_gt_u64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 4, v14
  v_mov_b32 v10, 0
  v_cmpx_ne_u64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 5, v14
  v_mov_b32 v10, 0
  v_cmpx_ge_u64_e32 v[2:3], v[4:5]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 6, v14
  v_mov_b32 v10, 0
  v_cmpx_t_u64_e64 v[4:5], v[2:3]
  v_mov_b32 v10, 1
  s_mov_b64 exec, s[20:21]
  v_lshl_or_b32 v14, v10, 7, v14
  buffer_store_dword v11, v1, s[0:3], 0 offen
  buffer_store_dword v12, v1, s[0:3], 0 offen offset:256
  buffer_store_dword v13, v1, s[0:3], 0 offen offset:512
  buffer_store_dword v14, v1, s[0:3], 0 offen offset:768
  s_endpgm

# Task 1-1：多场景微架构指标采集

## 环境准备

```bash
# 安装依赖
sudo apt update
sudo apt install -y stress-ng linux-tools-common linux-tools-$(uname -r)

# 放开 perf 权限
sudo sysctl -w kernel.perf_event_paranoid=0
sudo sysctl -w kernel.kptr_restrict=0
```

## 测试环境

详见 `results/env_info.txt`

- CPU: AMD EPYC 9K65 192-Core Processor (Zen 4 / Genoa)
- 核心: 16 Core / 32 Thread, 1 Socket
- 缓存: L1d 48KB/core, L2 1MB/core, L3 32MB shared
- 虚拟化: KVM
- 内核: 6.8.0-117-generic

## 采集命令

### ① 整数运算 (int64)

```bash
perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,L1-icache-load-misses,LLC-load-misses,branch-instructions,branch-misses,dTLB-load-misses,context-switches,cpu-migrations \
  -- stress-ng --cpu 1 --cpu-method int64 -t 30s
```

### ② 矩阵乘法 (matrixprod)

```bash
perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,L1-icache-load-misses,LLC-load-misses,branch-instructions,branch-misses,dTLB-load-misses,context-switches,cpu-migrations \
  -- stress-ng --cpu 1 --cpu-method matrixprod -t 30s
```

### ③ 连续访存 (read64)

```bash
perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,L1-icache-load-misses,LLC-load-misses,branch-instructions,branch-misses,dTLB-load-misses,context-switches,cpu-migrations \
  -- stress-ng --vm 1 --vm-bytes 1G --vm-method read64 --vm-keep -t 30s
```

### ④ 随机访存 (rand-set)

```bash
perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,L1-icache-load-misses,LLC-load-misses,branch-instructions,branch-misses,dTLB-load-misses,context-switches,cpu-migrations \
  -- stress-ng --vm 1 --vm-bytes 512M --vm-method rand-set -t 30s
```

### ⑤ N-皇后 (queens)

```bash
perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,L1-icache-load-misses,LLC-load-misses,branch-instructions,branch-misses,dTLB-load-misses,context-switches,cpu-migrations \
  -- stress-ng --cpu 1 --cpu-method queens -t 30s
```

## 原始输出文件

| 文件 | 说明 |
|------|------|
| `results/env_info.txt` | 测试环境信息 |
| `results/int64.txt` | 整数运算 perf stat 原始输出 |
| `results/matrixprod.txt` | 矩阵乘法 perf stat 原始输出 |
| `results/read64.txt` | 连续访存 perf stat 原始输出 |
| `results/rand-set.txt` | 随机访存 perf stat 原始输出 |
| `results/queens.txt` | N-皇后 perf stat 原始输出 |

## 注意事项

- LLC-load-misses 在本 KVM 环境中显示 `<not supported>`，这是虚拟化限制，不影响其他指标
- 所有采集均有约 56% 的监控占比（硬件计数器多路复用），需注意数据为缩放后估值
- rand-set 场景有显著的 sys 时间 (7.85s)，因随机地址触发大量页表操作

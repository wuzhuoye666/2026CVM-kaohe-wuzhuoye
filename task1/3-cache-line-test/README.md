# Task 1-3：AI 辅助编写 Cache Line 微基准测试

## 源代码

- `src/cache_line_test.c` — AI 辅助编写的 C 微基准测试程序

## 编译与运行

```bash
# 编译（-O0 避免编译器过度优化）
gcc -O0 -o cache_line_test src/cache_line_test.c -lm

# 全步长运行（输出延迟和吞吐量表）
./cache_line_test

# 单步长运行（配合 perf stat 使用）
./cache_line_test 1
./cache_line_test 64
```

## perf stat 采集各步长指标

```bash
# 遍历所有步长，采集 L1-dcache-load-misses 和 LLC-load-misses
for stride in 1 2 4 8 16 32 64 128 256; do
  echo "=== stride = ${stride} ==="
  perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,LLC-load-misses \
    ./cache_line_test ${stride} 2>&1 | tee results/stride_${stride}.txt
done
```

## 生成火焰图对比 (stride=1 vs stride=64)

```bash
# stride=1
perf record -F 99 -g -- ./cache_line_test 1
perf script > flamegraphs/stride_1.data
/opt/FlameGraph/stackcollapse-perf.pl flamegraphs/stride_1.data | \
  /opt/FlameGraph/flamegraph.pl > flamegraphs/stride_1_flame.svg

# stride=64
perf record -F 99 -g -- ./cache_line_test 64
perf script > flamegraphs/stride_64.data
/opt/FlameGraph/stackcollapse-perf.pl flamegraphs/stride_64.data | \
  /opt/FlameGraph/flamegraph.pl > flamegraphs/stride_64_flame.svg
```

## 分析要点

1. 将各步长性能数据绘制 **"步长 vs 延迟/吞吐量"曲线图**
2. 在曲线图上标注 **Cache Line 边界拐点**（通常在 64 字节处）
3. 解释拐点产生的微架构原因：
   - stride <= cache line 时，一次缓存行加载可服务多次访问
   - stride > cache line 时，每次访问需加载新的缓存行，Cache Miss 率骤升
4. 对比 stride=1 和 stride=64 的火焰图，分析 Cache Miss 处理路径差异
5. 记录 AI 工具使用过程于 `ai-chat-log/` 目录

## 输出文件

| 文件/目录 | 说明 |
|-----------|------|
| `src/cache_line_test.c` | 微基准测试源代码 |
| `results/stride_*.txt` | 各步长 perf 输出 |
| `flamegraphs/stride_1_flame.svg` | stride=1 火焰图 |
| `flamegraphs/stride_64_flame.svg` | stride=64 火焰图 |
| `ai-chat-log/` | AI 辅助对话记录 |

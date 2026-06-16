# Task 1-2：火焰图生成与热点分析

## 工具准备

```bash
# 克隆 FlameGraph（已完成）
git clone https://github.com/brendangregg/FlameGraph.git ~/FlameGraph
```

## 生成火焰图

### 选定负载：矩阵乘法 (matrixprod) + 随机访存 (rand-set)

选择理由：前者代表计算密集型（预计尖塔形态），后者代表访存密集型（预计扁平形态），
对比效果最鲜明。

### 矩阵乘法火焰图

```bash
cd /root/Project/2026CVM-kaohe-wuzhuoye/task1/2-flamegraph

perf record -F 99 -g -- stress-ng --cpu 1 --cpu-method matrixprod -t 30s
perf script > flamegraphs/matrixprod_perf.data
~/FlameGraph/stackcollapse-perf.pl flamegraphs/matrixprod_perf.data | \
  ~/FlameGraph/flamegraph.pl > flamegraphs/matrixprod_flame.svg
```

### 随机访存火焰图

```bash
perf record -F 99 -g -- stress-ng --vm 1 --vm-bytes 512M --vm-method rand-set -t 30s
perf script > flamegraphs/rand_mem_perf.data
~/FlameGraph/stackcollapse-perf.pl flamegraphs/rand_mem_perf.data | \
  ~/FlameGraph/flamegraph.pl > flamegraphs/rand_mem_flame.svg
```

## 生成文件

| 文件 | 说明 |
|------|------|
| `flamegraphs/matrixprod_flame.svg` | 矩阵乘法火焰图 |
| `flamegraphs/rand_mem_flame.svg` | 随机访存火焰图 |

## 分析要点

1. 在 SVG 中（浏览器打开）标注热点函数
2. 对比两种火焰图的"宽度"分布差异
3. 计算密集型是否呈现"尖塔"形态？访存/分支密集型是否更"扁平"？
4. 如出现内核态函数（`__do_page_fault`, `copy_page` 等），解释原因及性能影响

/*
 * cache_line_test.c — CPU Cache Line 大小对数组遍历性能的影响测试
 *
 * 编译: gcc -O0 -o cache_line_test cache_line_test.c -lm
 * 运行: ./cache_line_test
 * perf: perf stat -e L1-dcache-load-misses,LLC-load-misses ./cache_line_test <stride>
 *
 * 用法:
 *   ./cache_line_test           — 遍历所有默认步长
 *   ./cache_line_test <stride>  — 仅运行指定步长 (用于 perf stat 采集)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <math.h>

#define ARRAY_SIZE_MB  64          /* 数组大小 64MB，远超 LLC */
#define ARRAY_SIZE     (ARRAY_SIZE_MB * 1024 * 1024)
#define NUM_ACCESSES   (64 * 1024 * 1024) /* 每轮访问次数，固定总访问量 */
#define WARMUP_ITER    2
#define MEASURE_ITER   5

/* 默认测试步长列表 (字节) */
static const int DEFAULT_STRIDES[] = {1, 2, 4, 8, 16, 32, 64, 128, 256};
static const int NUM_DEFAULT_STRIDES = sizeof(DEFAULT_STRIDES) / sizeof(DEFAULT_STRIDES[0]);

static double get_time_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e9 + ts.tv_nsec;
}

/*
 * 以指定步长 (字节) 遍历数组，返回每次访问的平均延迟 (ns)
 * stride 单位为字节，按 sizeof(char) 计算偏移
 */
static double measure_stride(char *array, size_t array_size, int stride_bytes, long num_accesses) {
    volatile char sink;  /* 防止被优化掉 */
    long count;

    /* 计算实际可用的索引范围 */
    long max_idx = (long)(array_size / stride_bytes);
    if (max_idx < 1) max_idx = 1;

    double start = get_time_ns();

    for (count = 0; count < num_accesses; count++) {
        long idx = (count % max_idx) * stride_bytes;
        sink = array[idx];
    }

    double end = get_time_ns();
    (void)sink;

    return (end - start) / num_accesses;
}

int main(int argc, char *argv[]) {
    /* 分配数组，对齐到 4KB 页边界 */
    char *array = NULL;
    if (posix_memalign((void **)&array, 4096, ARRAY_SIZE) != 0) {
        fprintf(stderr, "Error: failed to allocate %d MB array\n", ARRAY_SIZE_MB);
        return 1;
    }

    /* 初始化数组，确保物理页已分配 */
    memset(array, 0xAA, ARRAY_SIZE);

    if (argc > 1) {
        /* 单步长模式 — 配合 perf stat 使用 */
        int stride = atoi(argv[1]);
        if (stride < 1) stride = 1;

        printf("[single-stride mode] stride = %d bytes\n", stride);
        printf("Array size: %d MB, accesses per iteration: %d\n",
               ARRAY_SIZE_MB, NUM_ACCESSES);

        /* warmup */
        for (int i = 0; i < WARMUP_ITER; i++) {
            measure_stride(array, ARRAY_SIZE, stride, NUM_ACCESSES);
        }

        /* measure */
        double total_latency = 0;
        for (int i = 0; i < MEASURE_ITER; i++) {
            double lat = measure_stride(array, ARRAY_SIZE, stride, NUM_ACCESSES);
            total_latency += lat;
            printf("  iter %d: %.2f ns/access\n", i + 1, lat);
        }
        printf("=> avg %.2f ns/access\n", total_latency / MEASURE_ITER);

    } else {
        /* 全步长遍历模式 */
        printf("=== Cache Line Stride Benchmark ===\n");
        printf("Array size: %d MB, accesses per iteration: %d\n",
               ARRAY_SIZE_MB, NUM_ACCESSES);
        printf("Warming up...\n\n");

        /* warmup all strides */
        for (int s = 0; s < NUM_DEFAULT_STRIDES; s++) {
            for (int i = 0; i < WARMUP_ITER; i++) {
                measure_stride(array, ARRAY_SIZE, DEFAULT_STRIDES[s], NUM_ACCESSES);
            }
        }

        printf("%-10s %-18s %-18s\n", "Stride(B)", "Latency(ns/acc)", "Throughput(MB/s)");
        printf("---------- ------------------ ------------------\n");

        for (int s = 0; s < NUM_DEFAULT_STRIDES; s++) {
            int stride = DEFAULT_STRIDES[s];
            double total_lat = 0;

            for (int i = 0; i < MEASURE_ITER; i++) {
                total_lat += measure_stride(array, ARRAY_SIZE, stride, NUM_ACCESSES);
            }

            double avg_lat = total_lat / MEASURE_ITER;
            /* 吞吐量: 每次访问读取 stride 字节 (实际有效利用取决于 cache line) */
            double throughput = (stride / avg_lat) * 1000.0; /* MB/s */

            printf("%-10d %-18.2f %-18.2f\n", stride, avg_lat, throughput);
        }

        printf("\n[提示] 使用以下命令采集 perf 指标:\n");
        printf("  perf stat -e cycles,instructions,cache-references,cache-misses,"
               "L1-dcache-load-misses,LLC-load-misses "
               "./cache_line_test <stride>\n");
    }

    free(array);
    return 0;
}

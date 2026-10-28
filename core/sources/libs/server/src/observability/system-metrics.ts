import { freemem, loadavg, totalmem, cpus, hostname, uptime } from "node:os";
import { statfs } from "node:fs/promises";
import { getEnv } from "../env.js";

export type DiskUsage = {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
};

export type SystemMetricsSnapshot = {
  collectedAt: string;
  hostname: string;
  process: {
    pid: number;
    uptimeSeconds: number;
    nodeVersion: string;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  host: {
    uptimeSeconds: number;
    cpuCount: number;
    loadAverage: {
      oneMinute: number;
      fiveMinute: number;
      fifteenMinute: number;
    };
    /** load1 / cpuCount — values above ~1 mean the host is saturated. */
    loadPerCpu: number;
    memory: {
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usedPercent: number;
    };
  };
  disks: DiskUsage[];
};

async function readDiskUsage(targetPath: string): Promise<DiskUsage | null> {
  try {
    const stats = await statfs(targetPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    if (totalBytes <= 0) return null;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      path: targetPath,
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: (usedBytes / totalBytes) * 100,
    };
  } catch {
    return null;
  }
}

export async function collectSystemMetrics(
  diskPaths: string[] = ["/", getEnv().LOG_SPOOL_DIR],
): Promise<SystemMetricsSnapshot> {
  const mem = process.memoryUsage();
  const total = totalmem();
  const free = freemem();
  const used = Math.max(0, total - free);
  const [one, five, fifteen] = loadavg();
  const cpuCount = Math.max(1, cpus().length);

  const uniquePaths = [...new Set(diskPaths.map((p) => p.trim()).filter(Boolean))];
  const disks: DiskUsage[] = [];
  for (const diskPath of uniquePaths) {
    const usage = await readDiskUsage(diskPath);
    if (!usage) continue;
    if (disks.some((d) => d.path === usage.path && d.totalBytes === usage.totalBytes)) {
      continue;
    }
    disks.push(usage);
  }

  return {
    collectedAt: new Date().toISOString(),
    hostname: hostname(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      arrayBuffersBytes: mem.arrayBuffers,
    },
    host: {
      uptimeSeconds: Math.floor(uptime()),
      cpuCount,
      loadAverage: {
        oneMinute: one,
        fiveMinute: five,
        fifteenMinute: fifteen,
      },
      loadPerCpu: one / cpuCount,
      memory: {
        totalBytes: total,
        freeBytes: free,
        usedBytes: used,
        usedPercent: total > 0 ? (used / total) * 100 : 0,
      },
    },
    disks,
  };
}

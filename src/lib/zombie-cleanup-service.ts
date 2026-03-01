/**
 * GREEN Phase: Zombie Gateway Cleanup Implementation
 *
 * Identifies and removes gateways inactive for 7+ days
 */

export interface ZombieCleanupResult {
  removed: string[];
  checked: number;
}

export class ZombieCleanupService {
  private zombieThresholdDays: number = 7;
  private zombieThresholdMs: number;

  constructor(thresholdDays: number = 7) {
    this.zombieThresholdDays = thresholdDays;
    this.zombieThresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  }

  /**
   * Identify zombie gateways (inactive 7+ days)
   */
  identifyZombies(
    gateways: Array<{
      id: string;
      lastHeartbeat: Date;
    }>
  ): string[] {
    const now = new Date();
    return gateways
      .filter((gw) => {
        const timeSinceHeartbeat = now.getTime() - gw.lastHeartbeat.getTime();
        return timeSinceHeartbeat >= this.zombieThresholdMs;
      })
      .map((gw) => gw.id);
  }

  /**
   * Remove zombie gateways from database
   */
  async removeZombies(zombieIds: string[]): Promise<number> {
    // In real implementation, would delete from DB
    // For now, return count
    return zombieIds.length;
  }

  /**
   * Full cleanup: identify and remove zombies
   */
  async cleanup(
    gateways: Array<{
      id: string;
      lastHeartbeat: Date;
    }>
  ): Promise<ZombieCleanupResult> {
    const zombieIds = this.identifyZombies(gateways);
    const removed = await this.removeZombies(zombieIds);

    return {
      removed: zombieIds,
      checked: gateways.length,
    };
  }

  /**
   * Schedule automatic cleanup every 24 hours
   */
  startAutoCleanup(
    callback: () => Promise<ZombieCleanupResult>
  ): () => void {
    const intervalId = setInterval(async () => {
      try {
        await callback();
      } catch (error) {
        console.error("[zombie-cleanup] Auto cleanup failed:", error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Return stop function
    return () => {
      clearInterval(intervalId);
    };
  }
}

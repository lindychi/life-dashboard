# 로그라이크 게임 품질 검증 전략

## 개요

로그라이크 게임은 **랜덤 생성**, **높은 재현성**, **복잡한 밸런스**를 특징으로 하므로, 결정론적 게임과는 다른 QA 접근이 필요합니다. 본 문서는 프로토타입 단계부터 적용 가능한 3가지 핵심 검증 영역을 정의합니다.

---

## 1. 랜덤 생성 시스템 테스트

### 1.1 Seed 기반 재현성 보장

**목표**: 동일한 seed로 항상 동일한 게임을 재현할 수 있어야 함

**구현 전략**:
```typescript
// 재현 가능한 RNG 구조
interface SeededRNG {
  seed: number;
  next(): number;
  fork(label: string): SeededRNG;  // 독립적인 하위 RNG 생성
}

// 테스트 케이스
describe("Dungeon Generation Reproducibility", () => {
  it("should generate identical dungeon with same seed", () => {
    const seed = 42;
    const dungeon1 = generateDungeon(seed);
    const dungeon2 = generateDungeon(seed);

    expect(dungeon1).toEqual(dungeon2);
  });

  it("should maintain reproducibility after save/load", () => {
    const game = new Game(seed: 1234);
    game.play(100);  // 100 턴 진행

    const state1 = game.save();
    const game2 = Game.load(state1);

    // 이후 진행이 동일해야 함
    expect(game.play(50)).toEqual(game2.play(50));
  });
});
```

**프로토타입 단계 체크리스트**:
- [ ] 모든 랜덤 요소가 시드 가능한 RNG를 사용하는가?
- [ ] `Math.random()` 직접 호출이 없는가?
- [ ] 날짜/시간 기반 랜덤 요소가 없는가?
- [ ] 멀티스레드 환경에서도 재현 가능한가?

---

### 1.2 통계적 분포 검증

**목표**: 랜덤 생성이 의도한 분포를 따르는지 검증

**테스트 프레임워크**:
```typescript
// 몬테카를로 기반 분포 테스트
class DistributionTest {
  runSamples(generator: () => any, count: number): StatResult {
    const samples = Array(count).fill(0).map(() => generator());
    return {
      mean: calculateMean(samples),
      variance: calculateVariance(samples),
      distribution: categorize(samples),
      outliers: detectOutliers(samples),
    };
  }

  assertDistribution(
    result: StatResult,
    expected: {
      mean: [min, max],
      variance: [min, max],
      outlierRate: number,
    }
  ) {
    expect(result.mean).toBeWithinRange(expected.mean);
    expect(result.outliers.length / samples).toBeLessThan(expected.outlierRate);
  }
}

// 실전 예시: 아이템 드롭률 검증
describe("Item Drop Rate Distribution", () => {
  it("should follow configured rarity distribution over 10k runs", () => {
    const test = new DistributionTest();
    const result = test.runSamples(() => dropItem(seed++), 10000);

    test.assertDistribution(result.distribution, {
      common: [0.50, 0.55],    // 50-55%
      rare: [0.25, 0.30],      // 25-30%
      epic: [0.10, 0.15],      // 10-15%
      legendary: [0.03, 0.07], // 3-7%
    });
  });
});
```

**주요 검증 대상**:
- **던전 구조**: 방 개수, 연결성, 막다른 길 비율
- **적 배치**: 난이도별 밀도, 보스 출현율
- **아이템 드롭**: 등급별 확률, 중복 방지
- **이벤트 발생**: 상점/보물방 출현 빈도

---

### 1.3 경계 조건 테스트

**목표**: 극단적 seed 값에서도 안정적으로 동작

```typescript
describe("Edge Case Seed Testing", () => {
  const edgeCases = [
    0, 1, -1,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    2147483647,  // Int32 최대값
  ];

  edgeCases.forEach(seed => {
    it(`should handle seed=${seed} without crash`, () => {
      expect(() => generateDungeon(seed)).not.toThrow();
    });
  });

  it("should not produce degenerate dungeons", () => {
    const dungeon = generateDungeon(extremeSeed);
    expect(dungeon.rooms.length).toBeGreaterThan(5);
    expect(dungeon.exits.length).toBeGreaterThan(0);
    expect(dungeon.unreachableRooms).toEqual([]);
  });
});
```

---

## 2. 밸런스 테스트 자동화

### 2.1 시뮬레이션 기반 밸런스 검증

**목표**: AI 플레이어가 수천 번 플레이하며 승률/생존시간 데이터 수집

**프레임워크 구조**:
```typescript
// AI 플레이어 인터페이스
interface AIPlayer {
  strategy: "random" | "aggressive" | "defensive" | "optimal";
  playGame(seed: number): GameResult;
}

// 시뮬레이션 러너
class BalanceSimulator {
  async runSimulation(config: {
    runs: number;
    seeds: number[];
    strategies: AIPlayer[];
  }): Promise<BalanceReport> {
    const results = [];

    for (const seed of config.seeds) {
      for (const ai of config.strategies) {
        const result = await ai.playGame(seed);
        results.push({ seed, strategy: ai.strategy, result });
      }
    }

    return this.analyzeResults(results);
  }

  private analyzeResults(results: GameResult[]): BalanceReport {
    return {
      winRate: groupBy(results, "strategy").map(calcWinRate),
      avgSurvivalTime: groupBy(results, "strategy").map(calcAvgTime),
      difficultySpike: detectDifficultySpikeFloors(results),
      deadlyCombo: detectOverpoweredCombos(results),
      uselessItems: detectUnusedItems(results),
    };
  }
}
```

**예시: 난이도 곡선 검증**:
```typescript
describe("Difficulty Balance", () => {
  it("should maintain 40-60% win rate for normal difficulty", async () => {
    const sim = new BalanceSimulator();
    const report = await sim.runSimulation({
      runs: 1000,
      seeds: generateSeeds(100),
      strategies: [new OptimalAI()],
    });

    expect(report.winRate).toBeWithinRange([0.40, 0.60]);
  });

  it("should not have difficulty spike > 30% between floors", async () => {
    const spikes = report.difficultySpike;
    expect(spikes.every(s => s.increase < 0.30)).toBe(true);
  });
});
```

---

### 2.2 빌드 조합 검증

**목표**: 모든 빌드 조합이 viable한지 검증 (trap build 제거)

**전략**:
```typescript
// 빌드 조합 생성기
class BuildGenerator {
  generateAllViableBuilds(): Build[] {
    const archetypes = ["melee", "ranged", "magic", "hybrid"];
    const builds = [];

    for (const archetype of archetypes) {
      // 아키타입별 핵심 아이템 조합 생성
      builds.push(...this.generateArchetypeBuilds(archetype));
    }

    return builds;
  }

  private generateArchetypeBuilds(archetype: string): Build[] {
    const coreItems = ARCHETYPE_CORE_ITEMS[archetype];
    const synergies = SYNERGY_ITEMS[archetype];

    // 코어 + 시너지 조합
    return combinations(coreItems, synergies).map(items => ({
      archetype,
      items,
      expectedWinRate: this.calculateTheoreticalWinRate(items),
    }));
  }
}

// 밸런스 테스트
describe("Build Viability", () => {
  it("all archetypes should have >30% win rate", async () => {
    const generator = new BuildGenerator();
    const builds = generator.generateAllViableBuilds();

    for (const build of builds) {
      const ai = new AIPlayer({ strategy: "optimal", forceBuild: build });
      const result = await runSimulation(ai, 100);

      expect(result.winRate).toBeGreaterThan(0.30);
    }
  });

  it("should not have trap items (never picked)", async () => {
    const usageStats = await collectItemUsageStats(1000);
    const trapItems = usageStats.filter(item => item.pickRate < 0.01);

    expect(trapItems).toEqual([]);
  });
});
```

---

### 2.3 밸런스 회귀 방지

**목표**: 패치 후 밸런스가 의도치 않게 무너지지 않도록 방지

**회귀 테스트 프레임워크**:
```typescript
// 기준선(baseline) 저장
class BalanceBaseline {
  async capture(version: string): Promise<void> {
    const report = await new BalanceSimulator().runSimulation({
      runs: 5000,
      seeds: FIXED_TEST_SEEDS,
      strategies: [new OptimalAI()],
    });

    await saveBaseline(version, report);
  }

  async compare(currentVersion: string): Promise<BalanceDiff> {
    const baseline = await loadBaseline(previousVersion);
    const current = await this.capture(currentVersion);

    return {
      winRateDiff: current.winRate - baseline.winRate,
      survivalTimeDiff: current.avgSurvivalTime - baseline.avgSurvivalTime,
      newDeadlyCombo: current.deadlyCombo.filter(c => !baseline.deadlyCombo.includes(c)),
      nerfedBuilds: detectNerfedBuilds(baseline, current),
    };
  }
}

// CI에서 자동 검증
describe("Balance Regression Test", () => {
  it("should not change win rate by more than 5%", async () => {
    const diff = await new BalanceBaseline().compare("1.2.0");
    expect(Math.abs(diff.winRateDiff)).toBeLessThan(0.05);
  });
});
```

---

## 3. 프로토타입 단계 테스트 프레임워크

### 3.1 최소 기능 테스트 세트 (MVP)

**프로토타입 단계에서 반드시 검증해야 할 것**:

```typescript
// 1단계: 재현성 검증 (최우선)
describe("[P0] Core Reproducibility", () => {
  it("same seed = same game", () => { /* ... */ });
  it("save/load preserves RNG state", () => { /* ... */ });
});

// 2단계: 기본 분포 검증
describe("[P1] Basic Distribution", () => {
  it("item rarity follows config", () => { /* ... */ });
  it("dungeon size within expected range", () => { /* ... */ });
});

// 3단계: 치명적 밸런스 이슈 탐지
describe("[P1] Critical Balance", () => {
  it("first boss is beatable with starter items", () => { /* ... */ });
  it("no softlock dungeons", () => { /* ... */ });
});
```

---

### 3.2 점진적 확장 전략

**프로토타입 → 알파 → 베타 단계별 QA 확장**:

| 단계 | 테스트 범위 | 시뮬레이션 규모 |
|------|------------|---------------|
| **프로토타입** | 재현성 + 기본 분포 | 100 runs |
| **알파** | + 밸런스 시뮬레이션 | 1,000 runs |
| **베타** | + 전체 빌드 조합 | 10,000 runs |
| **출시** | + 회귀 방지 + 실시간 모니터링 | 100,000 runs |

---

### 3.3 테스트 우선순위 매트릭스

**빠른 피드백 vs 철저한 검증의 균형**:

```typescript
// 빠른 스모크 테스트 (CI 푸시마다 실행, <1분)
npm run test:smoke
  - 재현성 테스트 (10 seeds)
  - 크래시 테스트 (극단값 seed)
  - 기본 분포 검증 (100 samples)

// 나이틀리 밸런스 테스트 (매일 밤 실행, ~30분)
npm run test:balance
  - 시뮬레이션 (1,000 runs)
  - 난이도 곡선 검증
  - 아키타입별 승률 측정

// 주간 풀 테스트 (주말 실행, ~4시간)
npm run test:full
  - 시뮬레이션 (10,000 runs)
  - 전체 빌드 조합 검증
  - 회귀 테스트
```

---

## 4. 도구 및 기술 스택

### 4.1 권장 테스트 프레임워크

**TypeScript/JavaScript 기반 프로젝트**:
- **테스트 러너**: Vitest (빠른 실행, TypeScript 네이티브)
- **통계 라이브러리**: simple-statistics, jStat
- **시각화**: Plotly.js (분포 그래프 생성)

**Python 기반 프로젝트** (시뮬레이션 스크립트):
- **테스트 러너**: pytest
- **통계**: NumPy, SciPy
- **시각화**: Matplotlib, Seaborn

---

### 4.2 CI/CD 통합

**GitHub Actions 예시**:
```yaml
name: Roguelike QA

on: [push, pull_request]

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:smoke
      - run: npm run test:reproducibility

  nightly-balance:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:balance
      - uses: actions/upload-artifact@v3
        with:
          name: balance-report
          path: reports/balance-*.json
```

---

## 5. 실전 체크리스트

### 프로토타입 단계 QA 체크리스트

- [ ] **재현성**: 동일 seed로 100% 동일한 게임 생성 확인
- [ ] **분포 검증**: 주요 랜덤 요소 1,000회 샘플 테스트
- [ ] **크래시 방지**: 극단값 seed 100개로 안정성 테스트
- [ ] **소프트락 방지**: AI 플레이어로 100게임 완주 가능 확인
- [ ] **치명적 밸런스**: 첫 보스 스타터 아이템으로 클리어 가능 확인

### 알파 단계 추가 체크리스트

- [ ] **난이도 곡선**: AI 플레이어 1,000게임 승률 40-60%
- [ ] **층간 난이도**: 층별 난이도 상승률 30% 이하
- [ ] **빌드 다양성**: 최소 4개 아키타입 각각 30% 이상 승률
- [ ] **trap build 제거**: 아이템 픽률 1% 이하인 항목 제거
- [ ] **회귀 테스트**: 이전 버전 대비 밸런스 변화 ±5% 이내

---

## 6. 결론

로그라이크 게임 QA는 **결정론적 재현성**, **통계적 분포 검증**, **자동화된 밸런스 시뮬레이션**의 3축으로 구성됩니다.

**프로토타입 단계부터 적용 가능한 핵심 전략**:
1. **Seed 기반 RNG** 시스템을 초기부터 구축 (재현성 보장)
2. **100-1,000 runs 시뮬레이션**으로 기본 분포 검증
3. **간단한 AI 플레이어**로 소프트락/치명적 밸런스 이슈 탐지

이를 통해 "손으로 수백 번 플레이해야 발견되는 문제"를 자동화하여, QA 효율성을 10-100배 향상시킬 수 있습니다.

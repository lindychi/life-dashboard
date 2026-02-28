# Game Balancing Guide

## Overview

게임 밸런싱을 위한 핵심 수치 조정 가이드. 모든 공식은 `src/lib/game/formulas.ts`에 중앙화되어 있어 손쉽게 튜닝 가능.

---

## Core Balancing Philosophy

### 1. 전투는 3-4턴 내에 결정
- 플레이어가 같은 레벨 일반 적을 **3-4회 공격**으로 처치
- 너무 빠르면 지루함, 너무 느리면 템포 저하
- Elite는 2배, Boss는 5배의 HP로 긴장감 유지

### 2. 방어력의 효용 감소
- 방어력 = 공격력일 때 **50% 데미지 감소**
- 무한정 방어 스택 방지 (고방어 빌드 견제)
- 공식: `damage_reduction = DEF / (DEF + 100)`

### 3. 크리티컬 소프트 캡
- 크리티컬 확률은 **50% 하드캡**
- 크리티컬 데미지는 기본 **150%** (1.5배)
- 크리티컬 빌드가 강력하지만 독점적이지 않도록

### 4. 속도 기반 턴 순서
- 속도가 높을수록 자주 행동
- SPD 10 = 10틱마다 행동, SPD 20 = 5틱마다 행동
- 속도 빌드의 가치 보장

---

## Stat Scaling by Level

### Class Growth Curves

#### Warrior (탱커/물리딜러)
```typescript
HP:  +15/level  // 가장 높은 생존력
MP:  +3/level   // 낮은 마나 (스킬 의존도 낮음)
ATK: +3/level   // 높은 물리 공격
DEF: +2/level   // 높은 방어력
MAG: +1/level   // 낮은 마법
RES: +1/level   // 낮은 마법 저항
SPD: +2/level   // 중간 속도
```

**강점**: 탱킹, 지속적 물리 딜
**약점**: 낮은 마법 저항, 마나 부족

#### Mage (마법 딜러)
```typescript
HP:  +8/level   // 낮은 생존력
MP:  +8/level   // 가장 높은 마나
ATK: +1/level   // 낮은 물리 공격
DEF: +1/level   // 낮은 방어력
MAG: +4/level   // 가장 높은 마법
RES: +2/level   // 중간 마법 저항
SPD: +2/level   // 중간 속도
```

**강점**: 강력한 AoE 마법, 높은 순간 딜
**약점**: 낮은 생존력, 마나 관리 필요

#### Rogue (속도/크리티컬)
```typescript
HP:  +10/level  // 중간 생존력
MP:  +4/level   // 중간 마나
ATK: +3/level   // 높은 물리 공격
DEF: +1/level   // 낮은 방어력
MAG: +1/level   // 낮은 마법
RES: +1/level   // 낮은 마법 저항
SPD: +4/level   // 가장 높은 속도
```

**강점**: 빠른 행동, 높은 크리티컬
**약점**: 낮은 방어력, 맞으면 위험

#### Cleric (힐러/서포터)
```typescript
HP:  +12/level  // 중상 생존력
MP:  +6/level   // 높은 마나
ATK: +2/level   // 중간 물리 공격
DEF: +2/level   // 중간 방어력
MAG: +3/level   // 높은 마법 (힐링 스케일링)
RES: +3/level   // 높은 마법 저항
SPD: +2/level   // 중간 속도
```

**강점**: 힐링, 버프, 부활
**약점**: 낮은 딜량 (서포터 역할)

---

## Experience Curve

### Formula
```
EXP_required = 100 * (level ^ 2.5)
```

### Level Table
```
Level  | EXP Required | Cumulative
-------|--------------|------------
1      | 0            | 0
2      | 100          | 100
3      | 282          | 382
4      | 566          | 948
5      | 1,000        | 1,948
10     | 3,162        | 14,328
15     | 7,247        | 51,948
20     | 13,454       | 134,228
30     | 33,437       | 481,390
50     | 111,803      | 2,944,439
100    | 1,000,000    | ~45,000,000
```

### 레벨업 속도 조정
- **지수값 증가** (2.5 → 3.0): 후반 레벨업이 더 어려워짐 (하드코어)
- **지수값 감소** (2.5 → 2.0): 레벨업이 더 쉬워짐 (캐주얼)
- **베이스 변경** (100 → 150): 전체 구간 난이도 상승

---

## Damage Formulas

### Physical Damage
```typescript
base_damage = ATK * skill_modifier
defense_reduction = DEF / (DEF + 100)
damage_after_defense = base_damage * (1 - defense_reduction)

// Critical check
if (random < crit_rate / 100):
  damage = damage * (crit_dmg / 100)

// Variance ±10%
final_damage = damage * (0.9 + random * 0.2)
```

**예시**:
- ATK 50, DEF 25, skill_modifier 1.5
- base = 75
- reduction = 25/(25+100) = 0.2 (20% 감소)
- after_defense = 75 * 0.8 = 60
- variance = 54-66
- **평균 데미지: 60**

### Magical Damage
```typescript
base_damage = MAG * skill_modifier
resistance_reduction = RES / (RES + 100)
damage_after_resistance = base_damage * (1 - resistance_reduction)

// No crit for magic (by default)

// Variance ±10%
final_damage = damage * (0.9 + random * 0.2)
```

### Healing
```typescript
base_healing = healing_value
mag_bonus = 1 + (MAG / 100)  // 10% per 10 MAG
healing = base_healing * mag_bonus

// Variance ±5%
final_healing = healing * (0.95 + random * 0.1)
```

**예시**:
- 힐링 스킬 50, MAG 30
- bonus = 1.3 (30% 증가)
- healing = 50 * 1.3 = 65
- variance = 62-72
- **평균 힐량: 65**

---

## Enemy Difficulty Multipliers

### Normal (일반 적)
```
HP:   1.0x
ATK:  0.8x  (플레이어보다 약간 약함)
DEF:  0.8x
EXP:  1.0x
Gold: 1.0x
```

### Elite (정예)
```
HP:   2.0x  (일반의 2배 체력)
ATK:  1.2x  (플레이어보다 강함)
DEF:  1.2x
EXP:  3.0x  (높은 보상)
Gold: 2.5x
```

### Boss (보스)
```
HP:   5.0x  (일반의 5배 체력)
ATK:  1.5x  (매우 강력)
DEF:  1.5x
EXP:  10.0x (큰 보상)
Gold: 5.0x
```

### Enemy Level Scaling
```typescript
// 레벨당 10% 스탯 증가
stat_at_level = base_stat * (1 + level * 0.1) * difficulty_multiplier
```

**예시**: Level 10 Elite Goblin
- Base HP: 50
- HP = 50 * (1 + 10 * 0.1) * 2.0 = 50 * 2.0 * 2.0 = **200 HP**

---

## Item Balance

### Upgrade System
```
stat_value = base_value * (1 + upgrade_level * 0.1)
```

- +0: 100% base stats
- +5: 150% base stats
- +10: 200% base stats (최대 강화)

### Rarity Multipliers (Sell Price)
```
Common:    1.0x
Uncommon:  2.0x
Rare:      5.0x
Epic:      10.0x
Legendary: 25.0x
```

### Affix Tiers
```
Tier 1: +5-10% stats  (common affixes)
Tier 2: +10-15% stats
Tier 3: +15-20% stats
Tier 4: +20-30% stats
Tier 5: +30-50% stats (legendary affixes)
```

**예시**: Flaming Sword of Swiftness (+5)
- Base: 20 ATK
- Upgrade: 20 * 1.5 = 30 ATK
- Prefix "Flaming" (Tier 2): +12% ATK = +3.6
- Suffix "of Swiftness" (Tier 3): +5 SPD
- **Final: 33 ATK, +5 SPD**

---

## Combat Balancing

### Action Gauge System
```
gauge_increment = SPD * 10
acts_when = gauge >= 1000
```

**턴 속도 비교**:
- SPD 10: 10틱마다 행동 (기준)
- SPD 15: 6.7틱마다 행동 (50% 빠름)
- SPD 20: 5틱마다 행동 (2배 빠름)
- SPD 5: 20틱마다 행동 (2배 느림)

### Status Effect Duration
```
Most buffs/debuffs: 3 turns
Strong effects: 1-2 turns
Weak effects: 5+ turns
```

### MP Cost Guidelines
```
Weak skill:    10-20 MP
Medium skill:  30-50 MP
Strong skill:  60-100 MP
Ultimate:      150-200 MP
```

**밸런싱 원칙**:
- Level 10 character: ~100 base MP
- 전투당 3-5회 스킬 사용 가능하도록

---

## Dungeon Generation

### Room Type Distribution
```
Combat:   60% (기본 전투)
Elite:    15% (어려운 전투)
Treasure: 10% (아이템 획득)
Rest:     10% (HP/MP 회복)
Shop:     5%  (아이템 구매)
Boss:     Always last room
```

### Room Count
```
Tier 1-3:   10-15 rooms
Tier 4-6:   15-20 rooms
Tier 7-10:  20-25 rooms
```

### Enemy Count per Room
```
Normal room: 2-4 enemies
Elite room:  1-2 elite enemies
Boss room:   1 boss + 0-2 minions
```

---

## Loot Drop Rates

### Quality Distribution (Normal Enemy)
```
Normal: 70%
Magic:  20%
Rare:   8%
Epic:   2%
```

### Quality Distribution (Boss)
```
Normal: 20%
Magic:  30%
Rare:   35%
Epic:   15%
```

### Drop Count
```
Normal enemy: 0-1 items (50% chance)
Elite enemy:  1-2 items (100% chance)
Boss:         3-5 items (100% chance, 50% guaranteed rare+)
Treasure room: 3 items (100% chance)
```

---

## Balancing Workflow

### 1. Initial Design
```bash
# Define target values in formulas.ts
export const GAME_CONSTANTS = {
  CRITICAL_HIT_BASE_CHANCE: 5,
  CRITICAL_HIT_DAMAGE_MULTIPLIER: 150,
  // ...
}
```

### 2. Playtest
- 레벨 1, 10, 20, 50 시점에서 테스트
- 각 클래스별 플레이 경험 측정
- 전투 길이, 난이도 체크

### 3. Data Collection
```sql
-- Average combat duration by tier
SELECT
  dungeon_tier,
  AVG(turn) as avg_turns,
  AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_seconds
FROM combat_instances
WHERE phase IN ('victory', 'defeat')
GROUP BY dungeon_tier;

-- Win rate by class
SELECT
  pc.class,
  COUNT(CASE WHEN dr.status = 'completed' THEN 1 END)::FLOAT / COUNT(*) as win_rate
FROM dungeon_runs dr
JOIN player_characters pc ON dr.player_id = pc.id
GROUP BY pc.class;
```

### 4. Iteration
- 너무 쉬운가? → 적 HP/ATK 증가, 보상 감소
- 너무 어려운가? → 적 스탯 감소, 플레이어 성장 가속
- 클래스 밸런스 → 성장 곡선 조정

### 5. Automated Testing
```typescript
// src/lib/game/__tests__/balance.test.ts
test('Level 10 warrior can kill level 10 normal enemy in 3-4 hits', () => {
  const warrior = createTestCharacter('warrior', 10);
  const enemy = createTestEnemy('goblin', 10, 'normal');

  const damage = calculatePhysicalDamage(warrior, enemy, 1.0);
  const hits_to_kill = Math.ceil(enemy.current_hp / damage.final_damage);

  expect(hits_to_kill).toBeGreaterThanOrEqual(3);
  expect(hits_to_kill).toBeLessThanOrEqual(4);
});
```

---

## Quick Tuning Checklist

### Combat feels too slow
- [ ] Increase player ATK/MAG growth
- [ ] Decrease enemy HP multiplier
- [ ] Increase skill damage modifiers
- [ ] Decrease defense effectiveness (increase DEFENSE_SCALING_CONSTANT)

### Combat feels too fast
- [ ] Increase enemy HP
- [ ] Decrease player damage growth
- [ ] Increase enemy DEF/RES
- [ ] Add more enemies per room

### Players die too often
- [ ] Increase HP growth per level
- [ ] Add more rest rooms
- [ ] Improve healing skill effectiveness
- [ ] Decrease enemy ATK multiplier

### Game too grindy
- [ ] Reduce EXP curve exponent
- [ ] Increase enemy EXP rewards
- [ ] Add EXP bonuses for combos/streaks
- [ ] Reduce dungeon room count

### Class imbalance detected
- [ ] Adjust class growth curves
- [ ] Modify class-specific skill power
- [ ] Add unique passive abilities
- [ ] Rebalance equipment availability

---

## Advanced Topics

### Diminishing Returns

일부 스탯은 무한 스택 방지를 위해 소프트캡 적용:

```typescript
// Critical rate: hard cap at 50%
crit_rate = Math.min(50, base_crit_rate + bonuses);

// Defense: diminishing returns built into formula
// At high DEF, each point adds less reduction
```

### Meta Considerations

- **Speed Meta**: 속도가 너무 강력하지 않도록 체력/방어 빌드도 경쟁력 유지
- **Crit Meta**: 크리티컬 50% 캡으로 다른 스탯 투자도 유의미하게
- **Tank Meta**: 방어력만으로는 부족하도록 DPS 체크 구간 추가

### Future Balance Levers

현재 구현되지 않았지만 추후 추가 가능:

1. **Elemental System**: 불/물/바람/땅 속성 상성
2. **Equipment Sets**: 세트 효과로 빌드 다양성
3. **Synergy Bonuses**: 특정 스킬 조합 시 보너스
4. **Dynamic Difficulty**: 플레이어 승률 기반 자동 조정

---

## References

- **Path of Exile**: Diminishing returns on defense
- **Slay the Spire**: Node-based progression, balanced encounters
- **Darkest Dungeon**: Speed-based turn order
- **Final Fantasy X**: CTB (Count Time Battle) system
- **Diablo 2**: Item affix system

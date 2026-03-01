"use client";

import { useCallback } from "react";
import StarRating from "@/components/StarRating";

const CATEGORIES = ["정확도", "완성도", "속도", "스타일", "유용성"] as const;

interface FeedbackCategoryTagsProps {
  selected: Record<string, number>;
  onChange: (categories: Record<string, number>) => void;
  compact?: boolean;
}

export default function FeedbackCategoryTags({
  selected,
  onChange,
  compact = false,
}: FeedbackCategoryTagsProps) {
  const toggleCategory = useCallback(
    (category: string) => {
      const next = { ...selected };
      if (next[category] !== undefined) {
        delete next[category];
      } else {
        next[category] = 3; // default rating
      }
      onChange(next);
    },
    [selected, onChange]
  );

  const setCategoryRating = useCallback(
    (category: string, rating: number) => {
      onChange({ ...selected, [category]: rating });
    },
    [selected, onChange]
  );

  return (
    <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"}`}>
      {CATEGORIES.map((cat) => {
        const isSelected = selected[cat] !== undefined;
        return (
          <div key={cat} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                isSelected
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400"
              }`}
              data-testid={`category-${cat}`}
            >
              {cat}
            </button>
            {isSelected && (
              <StarRating
                rating={selected[cat]}
                onChange={(r) => setCategoryRating(cat, r)}
                size="sm"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

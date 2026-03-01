"use client";

import { useState, useCallback } from "react";

interface StarRatingProps {
  rating: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: "sm" | "md";
}

const SIZE_CLASSES = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
} as const;

export default function StarRating({
  rating,
  onChange,
  readonly = false,
  size = "md",
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);

  const handleMouseEnter = useCallback(
    (star: number) => {
      if (!readonly && onChange) setHoverRating(star);
    },
    [readonly, onChange]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverRating(0);
  }, []);

  const handleClick = useCallback(
    (star: number) => {
      if (!readonly && onChange) onChange(star);
    },
    [readonly, onChange]
  );

  const displayRating = hoverRating || rating;
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div
      className="inline-flex items-center gap-0.5"
      onMouseLeave={handleMouseLeave}
      role="group"
      aria-label={`별점 ${rating}점`}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= displayRating;
        const interactive = !readonly && !!onChange;

        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            onClick={() => handleClick(star)}
            onMouseEnter={() => handleMouseEnter(star)}
            className={`${
              interactive
                ? "cursor-pointer hover:scale-110 transition-transform"
                : "cursor-default"
            } disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded`}
            aria-label={`${star}점`}
            data-testid={`star-${star}`}
          >
            <svg
              className={`${sizeClass} ${
                filled ? "text-amber-400" : "text-gray-700"
              } transition-colors`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

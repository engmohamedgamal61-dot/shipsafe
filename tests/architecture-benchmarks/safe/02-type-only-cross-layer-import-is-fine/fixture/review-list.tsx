import type { ReviewWithContext } from "@/domain/types";

interface ReviewListProps {
  reviews: ReviewWithContext[];
}

export function ReviewList({ reviews }: ReviewListProps) {
  return reviews.map((review) => review.id).join(", ");
}

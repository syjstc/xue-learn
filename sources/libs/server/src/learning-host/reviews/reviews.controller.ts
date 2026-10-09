import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUserId } from "../../../../common/src/index.js";
import { ReviewsService } from "./reviews.service.js";

@Controller('api/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('due')
  getDue(@CurrentUserId() userId: string) {
    return this.reviews.getDue(userId);
  }

  @Get('practice')
  getPractice(@CurrentUserId() userId: string) {
    return this.reviews.getPractice(userId);
  }

  @Post(':cardId')
  submitReview(
    @CurrentUserId() userId: string,
    @Param('cardId') cardId: string,
    @Body() body: { grade: number },
  ) {
    return this.reviews.submitReview(userId, cardId, body.grade);
  }
}

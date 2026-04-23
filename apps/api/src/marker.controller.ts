import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post
} from '@nestjs/common';
import { MarkingService } from './marking.service.js';

type SubmitMarkBody = {
  comments?: string;
  score?: number;
  signature?: string;
};

function requireMarkerId(markerId: string | undefined) {
  if (!markerId?.trim()) {
    throw new BadRequestException('Missing x-marker-id header');
  }

  return markerId;
}

@Controller('api/marker')
export class MarkerController {
  constructor(@Inject(MarkingService) private readonly markingService: MarkingService) {}

  @Get('exams')
  async listMarkerExams(@Headers('x-marker-id') markerId: string | undefined) {
    return this.markingService.listMarkerExams(requireMarkerId(markerId));
  }

  @Get('exams/:examId/tasks')
  async listMarkerTasks(
    @Param('examId') examId: string,
    @Headers('x-marker-id') markerId: string | undefined
  ) {
    return this.markingService.listMarkerTasks(examId, requireMarkerId(markerId));
  }

  @Get('tasks/:taskId')
  async getMarkerTask(
    @Param('taskId') taskId: string,
    @Headers('x-marker-id') markerId: string | undefined
  ) {
    return this.markingService.getMarkerTask(taskId, requireMarkerId(markerId));
  }

  @Post('tasks/:taskId/marks')
  async submitMark(
    @Param('taskId') taskId: string,
    @Headers('x-marker-id') markerId: string | undefined,
    @Body() body: SubmitMarkBody
  ) {
    if (
      typeof body.score !== 'number' ||
      !body.comments?.trim() ||
      !body.signature?.trim()
    ) {
      throw new BadRequestException('score, comments, and signature are required');
    }

    return this.markingService.submitMark({
      comments: body.comments,
      markerId: requireMarkerId(markerId),
      score: body.score,
      signature: body.signature,
      taskId
    });
  }
}

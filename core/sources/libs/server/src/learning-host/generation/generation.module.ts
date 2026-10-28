import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationController } from "./generation.controller.js";
import { GenerationService } from "./generation.service.js";
import { GenerationEventTransport } from "./event-transport.js";
import { InProcessGenerationEventTransport } from "./in-process-event-transport.js";

@Module({
  imports: [ConfigModule],
  controllers: [GenerationController],
  providers: [GenerationService, { provide: GenerationEventTransport, useClass: InProcessGenerationEventTransport }],
  exports: [GenerationService, GenerationEventTransport],
})
export class GenerationModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bot } from './entities/bot.entity';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Bot])],
    controllers: [BotsController],
    providers: [BotsService],
    exports: [BotsService]
})
export class BotsModule { }

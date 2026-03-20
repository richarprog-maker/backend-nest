import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SmartSplitService {
    private readonly logger = new Logger(SmartSplitService.name);

    async splitMessage(text: string): Promise<string[]> {
        if (!text) return [''];

        const normalized = text.replace(/\r\n/g, '\n').trim();
        if (!normalized) return [''];
        if (normalized.length < 100) return [normalized];

        try {
            const paragraphs = normalized
                .split(/\n{2,}/)
                .map((block) => block.trim())
                .filter(Boolean);

            if (paragraphs.length === 0) {
                return [normalized];
            }

            const groupedBlocks: string[] = [];

            for (let i = 0; i < paragraphs.length; i++) {
                const current = paragraphs[i];
                const next = paragraphs[i + 1];

                if (
                    next &&
                    !this.isListBlock(current) &&
                    this.isListBlock(next) &&
                    this.shouldAttachIntroToList(current)
                ) {
                    groupedBlocks.push(`${current}\n\n${next}`);
                    i++;
                    continue;
                }

                groupedBlocks.push(current);
            }

            const bubbles = groupedBlocks.flatMap((block) => this.splitRegularBlock(block));
            const withFinalCta = this.splitFinalCallToAction(bubbles);

            return withFinalCta.filter((bubble) => bubble.trim().length > 0);
        } catch (error) {
            this.logger.error('Error in deterministic SmartSplit, returning original', error);
            return [normalized];
        }
    }

    private splitRegularBlock(block: string): string[] {
        if (!block.trim()) return [];
        if (this.isListBlock(block)) return [block.trim()];
        if (block.length <= 420) return [block.trim()];

        const sentences = block.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [block];
        const chunks: string[] = [];
        let current = '';

        for (const sentence of sentences) {
            const candidate = current ? `${current} ${sentence}` : sentence;

            if (candidate.length <= 320) {
                current = candidate;
                continue;
            }

            if (current) {
                chunks.push(current.trim());
            }

            current = sentence;
        }

        if (current.trim()) {
            chunks.push(current.trim());
        }

        return chunks.length > 0 ? chunks : [block.trim()];
    }

    private splitFinalCallToAction(bubbles: string[]): string[] {
        if (bubbles.length === 0) return bubbles;

        const lastBubble = bubbles[bubbles.length - 1];
        if (this.isListBlock(lastBubble)) return bubbles;

        const match = lastBubble.match(/^([\s\S]*?)(\s*(?:¿[^?]+\?|[^.!?\n][^?\n]*\?)\s*)$/);
        if (!match) return bubbles;

        const body = match[1]?.trim();
        const cta = match[2]?.trim();

        if (!body || !cta) return bubbles;
        if (body.length < 25) return bubbles;

        return [...bubbles.slice(0, -1), body, cta];
    }

    private shouldAttachIntroToList(text: string): boolean {
        const normalized = text.replace(/\s+/g, ' ').trim();
        return normalized.length <= 180 || /[:：]$/.test(normalized);
    }

    private isListBlock(text: string): boolean {
        const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length === 0) return false;

        const listLines = lines.filter((line) =>
            /^([•*-]|\d+[.)])\s+/.test(line) ||
            /^[•*-]\s*\w+/i.test(line)
        );

        if (listLines.length >= 2) return true;

        const inlineEnumerations = text.match(/\b\d+[.)]\s+[^\n]+/g) || [];
        return inlineEnumerations.length >= 2;
    }
}

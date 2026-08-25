import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';

// gfm + breaks so single newlines from Gemini render as line breaks.
marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders a markdown string to HTML. Pure pipe, so it only re-parses when the
 * input string changes (e.g. each typewriter tick). The result is bound via
 * [innerHTML], which Angular sanitizes automatically — safe for model output.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    return marked.parse(value, { async: false }) as string;
  }
}

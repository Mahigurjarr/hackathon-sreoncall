import { LogPipelineRule } from '../models/log-pipeline.model';

/**
 * Generate Alloy loki.process config from pipeline rules.
 * Returns a River config snippet that can be appended to Alloy config.
 */
export function generateAlloyConfig(rules: LogPipelineRule[]): string {
  const enabledRules = rules.filter(r => r.enabled).sort((a, b) => a.order - b.order);

  if (enabledRules.length === 0) return '// No log pipeline rules configured';

  const stages = enabledRules.map(rule => {
    switch (rule.type) {
      case 'json_parse':
        return '  stage.json {\n    expressions = {}\n  }';
      case 'regex_extract':
        return `  stage.regex {\n    expression = ${JSON.stringify(rule.config.expression || '')}\n  }`;
      case 'label_set': {
        const labels = Object.entries(rule.config.labels || {})
          .map(([k, v]) => `      "${k}" = "${v}"`)
          .join(',\n');
        return `  stage.labels {\n    values = {\n${labels}\n    }\n  }`;
      }
      case 'line_filter':
        if (rule.config.action === 'drop') {
          return `  stage.drop {\n    expression = ${JSON.stringify(rule.config.match || '')}\n  }`;
        }
        return `  stage.match {\n    selector = ${JSON.stringify(rule.config.match || '')}\n  }`;
      case 'drop':
        return `  stage.drop {\n    expression = ${JSON.stringify(rule.config.match || '')}\n  }`;
      case 'redact':
        return `  stage.replace {\n    expression = ${JSON.stringify(rule.config.pattern || '')}\n    replace    = ${JSON.stringify(rule.config.replacement || '[REDACTED]')}\n  }`;
      default:
        return `  // Unknown rule type: ${(rule as any).type}`;
    }
  }).join('\n\n');

  return `// SREonCall Log Pipeline — auto-generated
loki.process "pipeline" {
${stages}

  forward_to = [otelcol.receiver.loki.default.receiver]
}`;
}

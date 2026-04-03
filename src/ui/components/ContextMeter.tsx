import React from "react";
import { Box, Text } from "ink";
import {
    getAutoCompactThresholdTokens,
    getWarningThresholdTokens,
    shouldAutoCompact,
    shouldWarnAboutContext,
    type ContextBudgetState,
} from "../../agent/contextBudget";

type Props = {
    budget: ContextBudgetState;
    compacted: boolean;
};

function getMeterColor(budget: ContextBudgetState): "green" | "yellow" | "red" {
    if (shouldAutoCompact(budget)) {
        return "red";
    }

    if (shouldWarnAboutContext(budget)) {
        return "yellow";
    }

    return "green";
}

export function ContextMeter({ budget, compacted }: Props): React.ReactElement {
    const { contextWindowTokens } = budget.config;
    const estimated = budget.estimatedContextTokens;
    const warning = getWarningThresholdTokens(budget.config);
    const autoCompact = getAutoCompactThresholdTokens(budget.config);
    const pct = contextWindowTokens > 0
        ? Math.min(100, Math.round((estimated / contextWindowTokens) * 100))
        : 0;

    return (
        <Box marginBottom={1}>
            <Text color="gray">ctx </Text>
            <Text color={getMeterColor(budget)}>
                {estimated}/{contextWindowTokens} tokens ({pct}%)
            </Text>
            <Text color="gray">
                {" "}
                · warn {warning}
                {" "}
                · compact {autoCompact}
            </Text>
            {compacted ? (
                <Text color="cyan"> · compacted</Text>
            ) : null}
            {budget.lastUsage?.totalTokens !== undefined ? (
                <Text color="gray"> · last API {budget.lastUsage.totalTokens}</Text>
            ) : null}
        </Box>
    );
}


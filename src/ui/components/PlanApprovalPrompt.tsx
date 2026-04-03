import React from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { type PlanApprovalState } from "../state";
import { RichText } from "./RichText";

type Props = {
    pendingPlanApproval?: PlanApprovalState;
    onDecision: (decision: "approve" | "reject") => void;
};

export function PlanApprovalPrompt({
    pendingPlanApproval,
    onDecision,
}: Props): React.ReactElement | null {
    const { isRawModeSupported } = useStdin();

    useInput((input) => {
        if (!pendingPlanApproval) {
            return;
        }

        const normalizedInput = input.toLowerCase();

        if (normalizedInput === "y") {
            onDecision("approve");
            return;
        }

        if (normalizedInput === "n") {
            onDecision("reject");
        }
    }, { isActive: isRawModeSupported && Boolean(pendingPlanApproval) });

    if (!pendingPlanApproval) {
        return null;
    }

    return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            <Text color="cyan">
                review plan: {pendingPlanApproval.filePath}{" "}
                <Text dimColor={true}>
                    {isRawModeSupported
                        ? "[y] approve  [n] stay in plan mode"
                        : "interactive input requires a real TTY"}
                </Text>
            </Text>
            <Box marginTop={1} paddingLeft={2} flexDirection="column">
                <RichText content={pendingPlanApproval.content} />
            </Box>
        </Box>
    );
}

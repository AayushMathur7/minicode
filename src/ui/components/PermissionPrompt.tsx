import React from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { type PermissionRequestState } from "../state";

type Props = {
    pendingPermission?: PermissionRequestState;
    onDecision: (decision: "allow" | "deny") => void;
};

export function PermissionPrompt({
    pendingPermission,
    onDecision,
}: Props): React.ReactElement | null {
    const { isRawModeSupported } = useStdin();

    useInput((input) => {
        if (!pendingPermission) {
            return;
        }

        const normalizedInput = input.toLowerCase();

        if (normalizedInput === "y") {
            onDecision("allow");
            return;
        }

        if (normalizedInput === "n") {
            onDecision("deny");
        }
    }, { isActive: isRawModeSupported && Boolean(pendingPermission) });

    if (!pendingPermission) {
        return null;
    }

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text color="yellow">
                approve {pendingPermission.toolName} ({pendingPermission.accessLevel})?{" "}
                <Text dimColor={true}>
                    {isRawModeSupported
                        ? "[y] allow  [n] deny"
                        : "interactive input requires a real TTY"}
                </Text>
            </Text>
        </Box>
    );
}

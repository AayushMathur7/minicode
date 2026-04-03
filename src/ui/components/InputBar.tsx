import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { type AgentMode } from "../../tools/policy";

type Props = {
    value: string;
    mode: AgentMode;
    disabled?: boolean;
};

export function InputBar({ value, mode, disabled = false }: Props): React.ReactElement {
    const [showCursor, setShowCursor] = useState(true);

    useEffect(() => {
        if (disabled) {
            setShowCursor(false);
            return;
        }

        const interval = setInterval(() => {
            setShowCursor((current) => !current);
        }, 500);

        return () => {
            clearInterval(interval);
        };
    }, [disabled]);

    return (
        <Box marginTop={1}>
            <Text>
                {mode === "plan" ? (
                    <Text dimColor={true}>[plan] </Text>
                ) : null}
                <Text bold>{">"}</Text>{" "}
                {disabled ? (
                    <Text dimColor={true}>working…</Text>
                ) : (
                    <>
                        {value}
                        <Text inverse={true}>{showCursor ? " " : ""}</Text>
                    </>
                )}
            </Text>
        </Box>
    );
}

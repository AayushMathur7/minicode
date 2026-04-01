import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

type Props = {
    value: string;
    disabled?: boolean;
};

export function InputBar({ value, disabled = false }: Props): React.ReactElement {
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

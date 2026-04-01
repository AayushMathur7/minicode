import React from "react";
import { Box, Text } from "ink";
import { type ActiveRunState } from "../state";

type Props = {
    state: ActiveRunState;
};

export function StatusBar({ state }: Props): React.ReactElement {
    return (
        <Box>
            <Text dimColor={true}>status </Text>
            <Text color={state.status === "failed" ? "red" : state.status === "completed" ? "green" : "yellow"}>
                {state.status}
            </Text>
            <Text dimColor={true}> · step </Text>
            <Text>{state.step}</Text>
            <Text dimColor={true}> · tool </Text>
            <Text>{state.currentTool ?? "none"}</Text>
        </Box>
    );
}

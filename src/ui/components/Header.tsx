import React from "react";
import { Box, Text } from "ink";

export function Header(): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Text bold color="cyan">
                Minicode
            </Text>
            <Text dimColor={true}>Local coding agent in the terminal</Text>
        </Box>
    );
}

import React from "react";
import { Box, Text } from "ink";
import { type RecentEvent } from "../../runtime/sessionTypes";

type Props = {
    recentEvents: RecentEvent[];
};

export function ActivityLog({ recentEvents }: Props): React.ReactElement {
    if (recentEvents.length === 0) {
        return (
            <Box>
                <Text dimColor={true}>No activity yet</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Text dimColor={true}>Activity</Text>
            {recentEvents.map((event) => (
                <Text key={event.id}>
                    <Text color="gray">•</Text> {event.text}
                </Text>
            ))}
        </Box>
    );
}

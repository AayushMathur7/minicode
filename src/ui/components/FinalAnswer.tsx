import React from "react";
import { Text } from "ink";

type Props = {
    error?: string;
};

export function FinalAnswer({ error }: Props): React.ReactElement | null {
    if (!error) {
        return null;
    }

    return (
        <Text color="red">error: {error}</Text>
    );
}

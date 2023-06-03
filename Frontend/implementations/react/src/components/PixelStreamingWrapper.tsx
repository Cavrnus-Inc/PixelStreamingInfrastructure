// Copyright Epic Games, Inc. All Rights Reserved.

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
    Config,
    AllSettings,
    PixelStreaming,
    // DataChannelOpenEvent
} from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.2';

export interface PixelStreamingWrapperProps {
    initialSettings?: Partial<AllSettings>;
}

export const PixelStreamingWrapper = ({
    initialSettings
}: PixelStreamingWrapperProps) => {
    // A reference to parent div element that the Pixel Streaming library attaches into:
    const videoParent = useRef<HTMLDivElement>(null);
    const urlParams = new URLSearchParams(window.location.search);
    const [inputValue, setInputValue] = useState('');
    const [customerValue, setCustomerValue] = useState('cav');
    const [error, setError] = useState(null);
    // Pixel streaming library instance is stored into this state variable after initialization:
    const [pixelStreaming, setPixelStreaming] = useState<PixelStreaming>();

    // A boolean state variable that determines if the Click to play overlay is shown:
    const [clickToPlayVisible, setClickToPlayVisible] = useState(false);

    // Run on component mount:
    useEffect(() => {
        if (videoParent.current) {
            // Attach Pixel Streaming library to videoParent element:
            const config = new Config({ initialSettings });
            const streaming = new PixelStreaming(config, {
                videoElementParent: videoParent.current
            });
            console.log(initialSettings);

            // register a playStreamRejected handler to show Click to play overlay if needed:
            streaming.addEventListener('playStreamRejected', () => {
                setClickToPlayVisible(true);
            });

            // Save the library instance into component state so that it can be accessed later:
            setPixelStreaming(streaming);

            // Clean up on component unmount:
            return () => {
                try {
                    streaming.disconnect();
                } catch { }
            };
        }
    }, []);

    // useEffect(() => {
    //     if (!pixelStreaming) return;
    //     pixelStreaming.addEventListener('dataChannelOpen', () => {});
    // }, [pixelStreaming]);

    const postEvent: React.MouseEventHandler<Element> = async (ev) => {
        ev.preventDefault();
        let token = inputValue || urlParams.get('token');
        let ssoToken;
        if (!token || !token.length) {
            setError('Token missing');
            return;
        }

        try {
            setError(null);
            const response = await axios.post('https://api.dev.cavrn.us/api/sso/token', {}, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json',
                    'X-Customer-Domain': customerValue,
                    'Authorization': `Bearer ${token}`
                }
            });
            console.log(response);
            ssoToken = response?.data?.token;
        } catch (e) {
            console.error(`SSO token request failed with ${e.message}`);
            setError(`${e.message}: ${e.response.data.message}`);
            return;
        }

        pixelStreaming.emitUIInteraction({
            type: 'authDataReceived',
            value: {
                token: ssoToken,
                joinCode: urlParams.get('joinCode'),
                room: urlParams.get('room'),
                domain: customerValue
            },
        });
    }

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                position: 'relative'
            }}
        >
            <div
                style={{
                    width: '100%',
                    height: '100%'
                }}
                ref={videoParent}
            />
            <div style={{
                zIndex: 999,
                position: 'absolute',
                top: '20px',
                left: '20px',
            }}>
                User Token:
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => { e.preventDefault(); setInputValue(e.target.value)}} />
                Customer Domain:
                <input
                    type="text"
                    value={customerValue}
                    onChange={(e) => { e.preventDefault(); setCustomerValue(e.target.value)}} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{
                        cursor: 'pointer',
                        color: 'rgb(138, 187, 42)',
                        border: '2px solid rgb(138, 187, 42)',
                        padding: '5px',
                        textAlign: 'center',
                        width: '150px'
                    }} onClick={postEvent} >
                        Log In with SSO
                    </div>
                    {error && <div style={{
                        padding: '5px',
                        color: 'red',
                    }}>
                        {error}
                    </div>}
                </ div>
            </div>
            {clickToPlayVisible && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                    }}
                    onClick={() => {
                        pixelStreaming?.play();
                        setClickToPlayVisible(false);
                    }}
                >
                    <div>Click to play</div>
                </div>
            )}
        </div>
    );
};

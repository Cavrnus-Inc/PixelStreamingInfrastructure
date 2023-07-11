// Copyright Epic Games, Inc. All Rights Reserved.

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
    Config,
    AllSettings,
    PixelStreaming,
} from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.2';
// import * as myConfig from '../../../../../SignallingWebServer/config.json';

export interface PixelStreamingWrapperProps {
    initialSettings?: Partial<AllSettings>;
}

export const PixelStreamingWrapper = ({
    initialSettings
}: PixelStreamingWrapperProps) => {
    // A reference to parent div element that the Pixel Streaming library attaches into:
    const videoParent = useRef<HTMLDivElement>(null);
    const urlParams = new URLSearchParams(window.location.search);
    const [sessionIdValue, setSessionIdValue] = useState(urlParams.get("session"));
    const [roomIdValue, setRoomIdValue] = useState(urlParams.get("room"));
    const [joinCodeValue, setJoinCodeValue] = useState(urlParams.get("joinCode"));
    const [tokenValue, setTokenValue] = useState(urlParams.get("token"));
    const [customerValue, setCustomerValue] = useState(urlParams.get("domain") === 'cav' ? 'cav.dev.cavrn.us' : urlParams.get("domain"));
    const [error, setError] = useState(null);
    const [inputsVisible, setInputsVisible] = useState(false);
    // Pixel streaming library instance is stored into this state variable after initialization:
    const [pixelStreaming, setPixelStreaming] = useState<PixelStreaming>();

    // A boolean state variable that determines if the Click to play overlay is shown:
    const [clickToPlayVisible, setClickToPlayVisible] = useState(false);

    // Run on component mount:
    useEffect(() => {
        if (videoParent.current) {
            // load config from SignallingWebServer
            const config = new Config({ initialSettings });
            console.log('Config:', config);

            // Attach Pixel Streaming library to videoParent element:
            const streaming = new PixelStreaming(config, {
                videoElementParent: videoParent.current
            });

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

    const postEvent: React.MouseEventHandler<Element> = async (ev) => {
        ev?.preventDefault();
        if (!tokenValue || !tokenValue.length) {
            setError('Token missing');
            return;
        }

        const event = {
            type: 'authDataReceived',
            value: {
                token: tokenValue,
                joinCode: joinCodeValue,
                room: roomIdValue,
                sessionId: sessionIdValue,
                domain: customerValue
            },
        };
        pixelStreaming?.play();
        console.log('emitUIInteraction()', event);
        pixelStreaming.emitUIInteraction(event);
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
            {inputsVisible && (
                <div style={{
                    zIndex: 99,
                    position: 'absolute',
                    top: '20px',
                    left: '20px',
                    color: 'rgb(138, 187, 42)',
                }}>
                    <table>
                        <tr>
                            <td>domain:</td>
                            <td><input
                                type="text"
                                style={{ margin: '5px' }}
                                value={customerValue}
                                onChange={(e) => { e.preventDefault(); setCustomerValue(e.target.value) }} />
                            </td>
                        </tr>
                        <tr>
                            <td>room:</td>
                            <td><input
                                type="text"
                                style={{ margin: '5px' }}
                                value={roomIdValue}
                                onChange={(e) => { e.preventDefault(); setRoomIdValue(e.target.value) }} />
                            </td>
                        </tr>
                        <tr>
                            <td>joinCode:</td>
                            <td><input
                                type="text"
                                style={{ margin: '5px' }}
                                value={joinCodeValue}
                                onChange={(e) => { e.preventDefault(); setJoinCodeValue(e.target.value) }} />
                            </td>
                        </tr>d
                        <tr>
                            <td>session:</td>
                            <td>
                                <input
                                    type="text"
                                    style={{ margin: '5px' }}
                                    value={sessionIdValue}
                                    onChange={(e) => { e.preventDefault(); setSessionIdValue(e.target.value) }} />
                            </td>
                        </tr>
                        <tr>
                            <td>token:</td>
                            <td>
                                <input
                                    type="text"
                                    style={{ margin: '5px' }}
                                    value={tokenValue}
                                    onChange={(e) => { e.preventDefault(); setTokenValue(e.target.value) }} />
                            </td>
                        </tr>

                    </table>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '5px' }}>
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
                    <div style={{ display: 'flex', paddingTop: '5px' }}>
                        <div style={{
                            cursor: 'pointer',
                            color: 'rgb(138, 187, 42)',
                            padding: '5px',
                            textAlign: 'center',
                            width: '75px'
                        }} onClick={() => setInputsVisible(false)}>
                            close
                        </div>
                    </div>
                </div>
            )}
            {
                clickToPlayVisible && (
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
                            postEvent(null);
                        }}
                    >
                        <div>Click to play</div>
                    </div>
                )
            }
        </div >
    );
};

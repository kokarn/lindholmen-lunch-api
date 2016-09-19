const request = require( 'request' );
const cheerio = require( 'cheerio' );
const express = require( 'express' );

const DEFAULT_PORT = 4321;
const INVALID_REQUEST_RESPONSE_CODE = 400;

// Load every hour
const LOAD_DISHES_INTERVAL = 3600000;
const TYPE_IMAGE_URLS = {
    Fisk: 'http://i.imgur.com/V0hxUyR.png',
    Kyckling: 'http://i.imgur.com/spExnvs.png',
    Kött: 'http://i.imgur.com/f4qJ0xe.png',
    Pasta: 'http://i.imgur.com/3NuKHcx.png',
    Sallad: 'http://i.imgur.com/nLKqIPD.png',
    Vegetariskt: 'http://i.imgur.com/nLKqIPD.png',
    Övrigt: 'http://i.imgur.com/lKpL4gp.png',
};

const app = express();

let dishes = {};

const specialTrim = function specialTrim ( unTrimmedString ) {
    return unTrimmedString
        .replace( /\t/gim, ' ' )
        .trim()
        .replace( /\s+/gim, ' ' );
};

const parseRow = function parseRow ( $row ) {
    const matchString = '</strong>';
    const name = $row.find( '.dish-name' ).html();
    const title = name.match( /<strong>(.+?)<\/strong>/im );
    const descStart = name.indexOf( matchString ) + matchString.length;
    const description = specialTrim( name.substr( descStart ) );
    const outputData =  {
        description: description,
        price: $row.find( '.table-list__column--price' ).text(),
        title: specialTrim( title[ 1 ] ),
        type: $row.find( '.icon-dish' ).text(),
    };

    if ( outputData.title === 'Veckans sallad' ) {
        outputData.type = 'Sallad';
    }

    return outputData;
};

const nameToIdentifier = function nameToIdentifier ( name ) {
    return name
        .toLowerCase()
        .replace( /['`]/gim, '' )
        .replace( /\s/gim, '-' );
};

const loadDishes = function loadDishes () {
    request( 'http://www.lindholmen.se/pa-omradet/dagens-lunch', ( error, response, body ) => {
        const $ = cheerio.load( body, {
            decodeEntities: false,
        } );
        const currentDishes = {};
        let currentRestaurantName = false;
        let currentRestaurantLink = false;

        $( '.table-list__row' ).each( ( index, element ) => {
            const $currentElement = $( element );

            if ( $currentElement.prev().hasClass( 'title' ) ) {
                const $title = $currentElement.prev();

                currentRestaurantName = $title.text();
                currentRestaurantLink = `http://www.lindholmen.se${ $title.find( 'a' ).attr( 'href' ) }`;

                if ( currentRestaurantName.indexOf( '(' ) > -1 ) {
                    currentRestaurantName = currentRestaurantName.substr( 0, currentRestaurantName.indexOf( '(' ) );
                }

                // Special case for '
                currentRestaurantName = currentRestaurantName.replace( /&#039;/gim, "'" );

                currentRestaurantName = currentRestaurantName.trim();

                currentDishes[ nameToIdentifier( currentRestaurantName ) ] = {
                    dishes: [],
                    link: currentRestaurantLink,
                    title: currentRestaurantName,
                };
            }

            currentDishes[ nameToIdentifier( currentRestaurantName ) ].dishes.push( parseRow( $( element ) ) );
        } );

        dishes = currentDishes;
    } );
};

app.get( '/', ( webRequest, response ) => {
    response.send( dishes );
} );

app.all( '/slack', ( webRequest, response ) => {
    let restaurant = false;
    const responseData = {
        attachments: [],
    };

    if ( !webRequest.query.restaurant ) {
        response.sendStatus( INVALID_REQUEST_RESPONSE_CODE );

        return false;
    }

    if ( typeof dishes[ webRequest.query.restaurant ] === 'undefined' ) {
        response.sendStatus( INVALID_REQUEST_RESPONSE_CODE );

        return false;
    }

    restaurant = dishes[ webRequest.query.restaurant ];

    responseData.text = `Dagens lunch på <${ restaurant.link }|${ restaurant.title }>`;

    for ( let i = 0; i < restaurant.dishes.length; i = i + 1 ) {
        responseData.attachments.push( {
            footer: restaurant.dishes[ i ].type,
            footer_icon: TYPE_IMAGE_URLS[ restaurant.dishes[ i ].type ], // eslint-disable-line camelcase
            text: restaurant.dishes[ i ].description,
            title: restaurant.dishes[ i ].title,
        } );
    }

    response.send( responseData );

    return true;
} );

loadDishes();
setTimeout( loadDishes, LOAD_DISHES_INTERVAL );

app.listen( process.env.PORT || DEFAULT_PORT, () => {
    console.log( 'Service up and running on port', process.env.PORT || DEFAULT_PORT );
} );

const request = require( 'request' );
const cheerio = require( 'cheerio' );
const express = require( 'express' );
const bodyParser = require( 'body-parser' );

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

// parse application/x-www-form-urlencoded
app.use( bodyParser.urlencoded( {
    extended: false,
} ) );

// parse application/json
app.use( bodyParser.json() );

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
    return new Promise( ( resolve, reject ) => {
        request( 'https://lindholmen.uit.se/omradet/dagens-lunch?embed-mode=iframe', ( error, response, body ) => {
            if ( error ) {
                reject( error );

                return false;
            }

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

            resolve();

            return true;
        } );
    } );
};

const getSlackMessageForRestaurant = function getSlackMessageForRestaurant ( restaurantName ) {
    const responseData = {
        attachments: [],
    };

    const restaurant = dishes[ restaurantName ];

    responseData.text = `Dagens lunch på <${ restaurant.link }|${ restaurant.title }>`;

    for ( let i = 0; i < restaurant.dishes.length; i = i + 1 ) {
        responseData.attachments.push( {
            footer: restaurant.dishes[ i ].type,
            footer_icon: TYPE_IMAGE_URLS[ restaurant.dishes[ i ].type ], // eslint-disable-line camelcase
            text: restaurant.dishes[ i ].description,
            title: restaurant.dishes[ i ].title,
        } );
    }

    return responseData;
};

const loadRestaurants = function loadRestaurants ( webRequest, response, next ) {
    if ( Object.keys( dishes ).length <= 0 ) {
        loadDishes()
            .then( () => {
                next();
            } )
            .catch( ( loadError ) => {
                console.log( loadError );
            } );
    } else {
        return next();
    }

    return true;
};

app.get( '/', loadRestaurants, ( webRequest, response ) => {
    response.send( dishes );
} );

app.all( '/slack', loadRestaurants, ( webRequest, response ) => {
    let restaurant = false;

    if ( webRequest.query.restaurant ) {
        restaurant = webRequest.query.restaurant;
    }

    if ( !restaurant && webRequest.body && webRequest.body.text ) {
        const parsedText = webRequest.body.text.replace( webRequest.body.trigger_word, '' );

        restaurant = parsedText.trim();
    }

    if ( !restaurant ) {
        response.sendStatus( INVALID_REQUEST_RESPONSE_CODE );

        return false;
    }

    if ( typeof dishes[ restaurant ] === 'undefined' ) {
        const restaurantsList = [];

        // eslint-disable-next-line guard-for-in
        for ( const identifier in dishes ) {
            restaurantsList.push( identifier );
        }


        response.send( {
            text: `Couldn't find any restaurant with that name. These are currently available: ${ restaurantsList.join( ', ' ) }`,
        } );

        return true;
    }

    response.send( getSlackMessageForRestaurant( restaurant ) );

    return true;
} );

loadDishes();
setTimeout( loadDishes, LOAD_DISHES_INTERVAL );

app.listen( process.env.PORT || DEFAULT_PORT, () => {
    console.log( 'Service up and running on port', process.env.PORT || DEFAULT_PORT );
} );
